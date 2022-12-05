import { GITHUB, LINEAR, SHARED } from "../constants";
import { LinearWebhookPayload } from "../../typings";
import prisma from "../../prisma";
import {
    decrypt,
    formatJSON,
    getAttachmentQuery,
    getSyncFooter,
    skipReason
} from "../index";
import { LinearClient } from "@linear/sdk";
import { replaceMentions, upsertUser } from "../../pages/api/utils";
import petitio from "petitio";
import { inviteMember } from "../linear";
import { components } from "@octokit/openapi-types";
import { linearQuery } from "../apollo";
import { getGitHubFooter } from "../github";
import { ApiError, getIssueUpdateError, getOtherUpdateError } from "../errors";
import { NextApiRequest } from "next";

export async function linearWebhookHandler(
    body: LinearWebhookPayload,
    originIp: string
) {
    if (!LINEAR.IP_ORIGINS.includes(`${originIp || ""}`)) {
        console.log("Could not verify Linear webhook.");
        throw new Error("Could not verify Linear webhook.");
    }

    const {
        action,
        updatedFrom,
        data,
        url,
        type: actionType
    }: LinearWebhookPayload = body;

    const syncs = await prisma.sync.findMany({
        where: {
            linearUserId: data.userId ?? data.creatorId
        },
        include: {
            LinearTeam: true,
            GitHubRepo: true
        }
    });

    if (
        syncs.length === 0 ||
        !syncs.find(
            sync =>
                sync.linearUserId === (data.userId ?? data.creatorId) &&
                sync.linearTeamId === data.teamId
        )
    ) {
        console.log("Could not find Linear user in syncs.");
        return "Could not find Linear user in syncs.";
    }

    const sync = syncs.find(
        sync =>
            sync.linearUserId === (data.userId ?? data.creatorId) &&
            sync.linearTeamId === data.teamId
    );

    if (!sync?.LinearTeam || !sync?.GitHubRepo) {
        console.log("Could not find ticket's corresponding repo.");
        throw new ApiError("Could not find ticket's corresponding repo.", 404);
    }

    const {
        linearUserId,
        linearApiKey,
        linearApiKeyIV,
        githubApiKey,
        githubUserId,
        githubApiKeyIV,
        LinearTeam: { publicLabelId, doneStateId, canceledStateId },
        GitHubRepo: { repoName: repoFullName, repoId }
    } = sync;

    const linearKey = process.env.LINEAR_API_KEY
        ? process.env.LINEAR_API_KEY
        : decrypt(linearApiKey, linearApiKeyIV);

    const linear = new LinearClient({
        apiKey: linearKey
    });

    const ticketName = `${data.team?.key ?? ""}-${data.number}`;

    const githubKey = process.env.GITHUB_API_KEY
        ? process.env.GITHUB_API_KEY
        : decrypt(githubApiKey, githubApiKeyIV);

    const githubAuthHeader = `token ${githubKey}`;
    const userAgentHeader = `${repoFullName}, linear-github-sync`;
    const issuesEndpoint = `https://api.github.com/repos/${repoFullName}/issues`;

    // Map the user's Linear username to their GitHub username if not yet mapped
    await upsertUser(
        linear,
        githubUserId,
        linearUserId,
        userAgentHeader,
        githubAuthHeader
    );

    const syncedIssue = await prisma.syncedIssue.findFirst({
        where: {
            linearIssueId: data.id,
            linearTeamId: data.teamId
        },
        include: { GitHubRepo: true }
    });

    if (action === "update") {
        // Label updated on an already-Public issue
        if (updatedFrom.labelIds?.includes(publicLabelId)) {
            if (!syncedIssue) {
                console.log(skipReason("label", ticketName));
                return skipReason("label", ticketName);
            }

            // Label(s) removed
            if (data.labelIds.length < updatedFrom.labelIds.length) {
                const removedLabelId = updatedFrom.labelIds.find(
                    id => !data.labelIds.includes(id)
                );

                // Public label removed
                if (removedLabelId === publicLabelId) {
                    await prisma.syncedIssue.delete({
                        where: { id: syncedIssue.id }
                    });

                    const reason = `Deleted synced issue ${ticketName} after Public label removed.`;
                    console.log(reason);
                    return reason;
                }

                const label = await linear.issueLabel(removedLabelId);
                if (!label) {
                    throw new ApiError("Could not find label.", 403);
                }

                const removedLabelResponse = await petitio(
                    `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels/${label.name}`,
                    "DELETE"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .send();

                if (removedLabelResponse.statusCode > 201) {
                    console.log(`Could not remove label "${label.name}".`);
                    throw new ApiError(
                        `Could not remove label "${label.name}".`,
                        403
                    );
                } else {
                    console.log(
                        `Removed label "${label.name}" from issue #${syncedIssue.githubIssueNumber}.`
                    );
                }
            } else if (data.labelIds.length > updatedFrom.labelIds.length) {
                const addedLabelId = data.labelIds.find(
                    id => !updatedFrom.labelIds.includes(id)
                );

                const label = await linear.issueLabel(addedLabelId);
                if (!label) {
                    throw new ApiError("Could not find label.", 403);
                }

                const createdLabelResponse = await petitio(
                    `https://api.github.com/repos/${repoFullName}/labels`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        name: label.name,
                        color: label.color.replace("#", ""),
                        description: "Created by Linear-GitHub Sync"
                    })
                    .send();

                const createdLabelData = await createdLabelResponse.json();

                if (
                    createdLabelResponse.statusCode > 201 &&
                    createdLabelData.errors?.[0]?.code !== "already_exists"
                ) {
                    console.log("Could not create label.");
                    throw new ApiError("Could not create label.", 403);
                }

                const labelName =
                    createdLabelData.errors?.[0]?.code === "already_exists"
                        ? label.name
                        : createdLabelData.name;

                const appliedLabelResponse = await petitio(
                    `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({ labels: [labelName] })
                    .send();

                if (appliedLabelResponse.statusCode > 201) {
                    console.log("Could not apply label.");
                    throw new ApiError("Could not apply label.", 403);
                } else {
                    console.log(
                        `Applied label "${labelName}" to issue #${syncedIssue.githubIssueNumber}.`
                    );
                }
            }
        } else if (
            updatedFrom.labelIds &&
            !updatedFrom.labelIds?.includes(publicLabelId) &&
            data.labelIds?.includes(publicLabelId)
        ) {
            // Public label added to an issue
            if (syncedIssue) {
                console.log(
                    `Not creating issue after label added as issue ${ticketName} [${data.id}] already exists on GitHub as issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                );

                return "Issue already exists on GitHub.";
            }

            const modifiedDescription = await replaceMentions(
                data.description,
                "linear"
            );

            const assignee = await prisma.user.findFirst({
                where: { linearUserId: data.assigneeId },
                select: { githubUsername: true }
            });

            const createdIssueResponse = await petitio(issuesEndpoint, "POST")
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    title: `[${ticketName}] ${data.title}`,
                    body: `${
                        modifiedDescription ?? ""
                    }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`,
                    assignees: [
                        data.assigneeId && assignee?.githubUsername
                            ? assignee?.githubUsername
                            : ""
                    ]
                })
                .send();

            if (
                !syncs.some(
                    sync =>
                        sync.linearUserId === (data.userId ?? data.creatorId)
                )
            ) {
                inviteMember(data.creatorId, data.teamId, repoFullName, linear);
            }

            if (createdIssueResponse.statusCode > 201) {
                console.log(
                    `Failed to create GitHub issue for ${data.team.key}-${
                        data.number
                    }, received status code ${
                        createdIssueResponse.statusCode
                    }, body of ${formatJSON(
                        await createdIssueResponse.json()
                    )}.`
                );

                throw new ApiError(
                    `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`,
                    500
                );
            }

            let createdIssueData: components["schemas"]["issue"] =
                await createdIssueResponse.json();

            const linearIssue = await linear.issue(data.id);

            const attachmentQuery = getAttachmentQuery(
                data.id,
                createdIssueData.number,
                repoFullName
            );

            await Promise.all([
                linearQuery(attachmentQuery, linearKey).then(response => {
                    if (!response?.data?.attachmentCreate?.success) {
                        console.log(
                            `Failed to create attachment on ${ticketName} for GitHub issue #${
                                createdIssueData.number
                            }, received response ${
                                response?.error ?? response?.data ?? ""
                            }.`
                        );
                    } else {
                        console.log(
                            `Created attachment on ${ticketName} for GitHub issue #${createdIssueData.number}.`
                        );
                    }
                }),
                prisma.syncedIssue.create({
                    data: {
                        githubIssueId: createdIssueData.id,
                        linearIssueId: data.id,
                        linearTeamId: data.teamId,
                        githubIssueNumber: createdIssueData.number,
                        linearIssueNumber: data.number,
                        githubRepoId: repoId
                    }
                })
            ] as Promise<any>[]);

            // Apply all labels to newly-created issue
            const labelIds = data.labelIds.filter(id => id != publicLabelId);
            const labelNames: string[] = [];
            for (const labelId of labelIds) {
                if (labelId === publicLabelId) continue;

                const label = await linear.issueLabel(labelId);
                if (!label) {
                    console.log(
                        `Could not find label ${labelId} for ${ticketName}.`
                    );
                    continue;
                }

                const createdLabelResponse = await petitio(
                    `https://api.github.com/repos/${repoFullName}/labels`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        name: label.name,
                        color: label.color?.replace("#", ""),
                        description: "Created by Linear-GitHub Sync"
                    })
                    .send();
                const createdLabelData = await createdLabelResponse.json();
                if (
                    createdLabelResponse.statusCode > 201 &&
                    createdLabelData.errors?.[0]?.code !== "already_exists"
                ) {
                    console.log(
                        `Could not create GH label "${label.name}" in ${repoFullName}.`
                    );
                    continue;
                }

                const labelName =
                    createdLabelData.errors?.[0]?.code === "already_exists"
                        ? label.name
                        : createdLabelData.name;

                labelNames.push(labelName);
            }

            // Add priority label if applicable
            if (!!data.priority && SHARED.PRIORITY_LABELS[data.priority]) {
                const priorityLabel = SHARED.PRIORITY_LABELS[data.priority];
                const createdLabelResponse = await petitio(
                    `https://api.github.com/repos/${repoFullName}/labels`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        name: priorityLabel.name,
                        color: priorityLabel.color?.replace("#", ""),
                        description: "Created by Linear-GitHub Sync"
                    })
                    .send();
                const createdLabelData = await createdLabelResponse.json();
                if (
                    createdLabelResponse.statusCode > 201 &&
                    createdLabelData.errors?.[0]?.code !== "already_exists"
                ) {
                    console.log(
                        `Could not create priority label "${priorityLabel.name}" in ${repoFullName}.`
                    );
                } else {
                    const labelName =
                        createdLabelData.errors?.[0]?.code === "already_exists"
                            ? priorityLabel.name
                            : createdLabelData.name;

                    labelNames.push(labelName);
                }
            }

            const appliedLabelResponse = await petitio(
                `${issuesEndpoint}/${createdIssueData.number}/labels`,
                "POST"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({ labels: labelNames })
                .send();

            if (appliedLabelResponse.statusCode > 201) {
                console.log(
                    `Could not apply labels to #${createdIssueData.number} in ${repoFullName}.`
                );
            } else {
                console.log(
                    `Applied labels to #${createdIssueData.number} in ${repoFullName}.`
                );
            }

            // Sync all comments on the issue
            const linearComments = await linearIssue.comments().then(comments =>
                Promise.all(
                    comments.nodes.map(comment =>
                        comment.user?.then(user => ({
                            comment,
                            user
                        }))
                    )
                )
            );

            for (const linearComment of linearComments) {
                if (!linearComment) continue;

                const { comment, user } = linearComment;

                const modifiedComment = await replaceMentions(
                    comment.body,
                    "linear"
                );

                await petitio(
                    `${issuesEndpoint}/${createdIssueData.number}/comments`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        body: `${modifiedComment ?? ""}${getGitHubFooter(
                            user.displayName
                        )}`
                    })
                    .send()
                    .then(commentResponse => {
                        if (commentResponse.statusCode > 201)
                            console.log(
                                getOtherUpdateError(
                                    "comment",
                                    data,
                                    createdIssueData,
                                    createdIssueResponse,
                                    commentResponse.json()
                                )
                            );
                        else
                            console.log(
                                `Created comment on GitHub issue #${createdIssueData.number} [${createdIssueData.id}] for Linear issue ${ticketName}.`
                            );
                    });
            }
        }

        // Ensure there is a synced issue to update
        if (!syncedIssue) {
            const reason = skipReason("edit", ticketName);
            console.log(reason);
            return reason;
        }

        // Title change
        if (updatedFrom.title && actionType === "Issue") {
            await petitio(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                "PATCH"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    title: `[${ticketName}] ${data.title}`
                })
                .send()
                .then(updatedIssueResponse => {
                    if (updatedIssueResponse.statusCode > 201)
                        console.log(
                            getIssueUpdateError(
                                "title",
                                data,
                                syncedIssue,
                                updatedIssueResponse
                            )
                        );
                    else
                        console.log(
                            `Updated GitHub issue title for ${ticketName} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                        );
                });
        }

        // Description change
        if (updatedFrom.description && actionType === "Issue") {
            const modifiedDescription = await replaceMentions(
                data.description,
                "linear"
            );

            await petitio(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                "PATCH"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    body: `${
                        modifiedDescription ?? ""
                    }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`
                })
                .send()
                .then(updatedIssueResponse => {
                    if (updatedIssueResponse.statusCode > 201)
                        console.log(
                            getIssueUpdateError(
                                "description",
                                data,
                                syncedIssue,
                                updatedIssueResponse
                            )
                        );
                    else
                        console.log(
                            `Updated GitHub issue description for ${ticketName} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                        );
                });
        }

        // State change (eg. "Open" to "Done")
        if (updatedFrom.stateId) {
            await petitio(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                "PATCH"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    state: [doneStateId, canceledStateId].includes(data.stateId)
                        ? "closed"
                        : "open",
                    state_reason:
                        doneStateId === data.stateId
                            ? "completed"
                            : "not_planned"
                })
                .send()
                .then(updatedIssueResponse => {
                    if (updatedIssueResponse.statusCode > 201)
                        console.log(
                            getIssueUpdateError(
                                "state",
                                data,
                                syncedIssue,
                                updatedIssueResponse
                            )
                        );
                    else
                        console.log(
                            `Updated GitHub issue state for ${ticketName} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                        );
                });
        }

        // Assignee change
        if ("assigneeId" in updatedFrom) {
            const assigneeEndpoint = `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/assignees`;

            // Assignee added
            const assignee = data.assigneeId
                ? await prisma.user.findFirst({
                      where: {
                          linearUserId: data.assigneeId
                      },
                      select: {
                          githubUsername: true
                      }
                  })
                : null;

            if (assignee) {
                const response = await petitio(assigneeEndpoint, "POST")
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({ assignees: [assignee.githubUsername] })
                    .send();

                if (response.statusCode > 201) {
                    console.log(
                        getIssueUpdateError(
                            "assignee",
                            data,
                            syncedIssue,
                            response
                        )
                    );
                } else {
                    console.log(
                        `Added assignee to GitHub issue #${syncedIssue.githubIssueNumber} for ${ticketName}.`
                    );
                }
            } else {
                console.log(
                    `Skipping assignee for ${ticketName} as no GitHub username was found for Linear user ${data.assigneeId}.`
                );
            }

            // Remove previous assignee only if reassigned or deassigned explicitly
            if (
                updatedFrom.assigneeId !== null &&
                (assignee || data.assigneeId === undefined)
            ) {
                const prevAssignee = await prisma.user.findFirst({
                    where: {
                        linearUserId: updatedFrom.assigneeId
                    },
                    select: {
                        githubUsername: true
                    }
                });

                if (prevAssignee) {
                    const response = await petitio(assigneeEndpoint, "DELETE")
                        .header("User-Agent", userAgentHeader)
                        .header("Authorization", githubAuthHeader)
                        .body({ assignees: [prevAssignee.githubUsername] })
                        .send();

                    if (response.statusCode > 201) {
                        console.log(
                            getIssueUpdateError(
                                "assignee",
                                data,
                                syncedIssue,
                                response
                            )
                        );
                    } else {
                        console.log(
                            `Removed assignee on GitHub issue #${syncedIssue.githubIssueNumber} for ${ticketName}.`
                        );
                    }
                } else {
                    console.log(
                        `Skipping assignee removal for ${ticketName} as no GitHub username was found for Linear user ${updatedFrom.assigneeId}.`
                    );
                }
            }
        }

        if ("priority" in updatedFrom) {
            const priorityLabels = SHARED.PRIORITY_LABELS;

            if (
                !priorityLabels[data.priority] ||
                !priorityLabels[updatedFrom.priority]
            ) {
                const reason = `Could not find a priority label for ${updatedFrom.priority} or ${data.priority}.`;
                console.log(reason);
                throw new ApiError(reason, 403);
            }

            // Remove old priority label
            const prevPriorityLabel = priorityLabels[updatedFrom.priority];
            const removedLabelResponse = await petitio(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels/${prevPriorityLabel.name}`,
                "DELETE"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .send();

            if (removedLabelResponse.statusCode > 201) {
                console.log(
                    `Did not remove priority label "${prevPriorityLabel.name}".`
                );
            } else {
                console.log(
                    `Removed priority "${prevPriorityLabel.name}" from issue #${syncedIssue.githubIssueNumber}.`
                );
            }

            if (data.priority === 0) {
                return `Removed priority label "${prevPriorityLabel.name}" from issue #${syncedIssue.githubIssueNumber}.`;
            }

            // Add new priority label if not none
            const priorityLabel = priorityLabels[data.priority];
            const createdLabelResponse = await petitio(
                `https://api.github.com/repos/${repoFullName}/labels`,
                "POST"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    name: priorityLabel.name,
                    color: priorityLabel.color?.replace("#", ""),
                    description: "Created by Linear-GitHub Sync"
                })
                .send();

            const createdLabelData = await createdLabelResponse.json();

            if (
                createdLabelResponse.statusCode > 201 &&
                createdLabelData.errors?.[0]?.code !== "already_exists"
            ) {
                console.log("Could not create label.");
                throw new ApiError("Could not create label.", 403);
            }

            const labelName =
                createdLabelData.errors?.[0]?.code === "already_exists"
                    ? priorityLabel.name
                    : createdLabelData.name;

            const appliedLabelResponse = await petitio(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels`,
                "POST"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({ labels: [labelName] })
                .send();

            if (appliedLabelResponse.statusCode > 201) {
                console.log("Could not apply label.");
                throw new ApiError("Could not apply label.", 403);
            } else {
                console.log(
                    `Applied priority label "${labelName}" to issue #${syncedIssue.githubIssueNumber}.`
                );
            }
        }
    } else if (action === "create") {
        if (actionType === "Comment") {
            // Comment added

            if (data.id.includes(GITHUB.UUID_SUFFIX)) {
                console.log(skipReason("comment", data.issue!.id, true));

                return skipReason("comment", data.issue!.id, true);
            }

            // Overrides the outer-scope syncedIssue because comments do not come with teamId
            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    linearIssueId: data.issueId
                },
                include: { GitHubRepo: true }
            });

            if (!syncedIssue) {
                console.log(
                    skipReason("comment", `${data.team?.key}-${data.number}`)
                );

                return skipReason(
                    "comment",
                    `${data.team?.key}-${data.number}`
                );
            }

            const modifiedBody = await replaceMentions(data.body, "linear");

            await petitio(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/comments`,
                "POST"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    body: `${modifiedBody ?? ""}${getGitHubFooter(
                        data.user?.name
                    )}`
                })
                .send()
                .then(commentResponse => {
                    if (commentResponse.statusCode > 201)
                        console.log(
                            `Failed to update GitHub issue state for ${
                                data.issue?.id
                            } on GitHub issue #${
                                syncedIssue.githubIssueNumber
                            } [${
                                syncedIssue.githubIssueId
                            }], received status code ${
                                commentResponse.statusCode
                            }, body of ${formatJSON(commentResponse.json())}.`
                        );
                    else
                        console.log(
                            `Synced comment [${data.id}] for ${data.issue?.id} on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                        );
                });
        } else if (actionType === "Issue") {
            // Issue created

            if (!data.labelIds?.includes(publicLabelId)) {
                const reason = "Issue is not labeled as public";
                console.log(reason);
                return reason;
            }

            if (syncedIssue) {
                const reason = `Not creating issue after label added as issue ${ticketName} already exists on GitHub as #${syncedIssue.githubIssueNumber}.`;
                console.log(reason);
                return reason;
            }

            if (data.id?.includes(GITHUB.UUID_SUFFIX)) {
                const reason = skipReason("issue", data.id, true);
                console.log(reason);
                return reason;
            }

            const modifiedDescription = await replaceMentions(
                data.description,
                "linear"
            );

            const assignee = await prisma.user.findFirst({
                where: { linearUserId: data.assigneeId },
                select: { githubUsername: true }
            });

            const createdIssueResponse = await petitio(issuesEndpoint, "POST")
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({
                    title: `[${ticketName}] ${data.title}`,
                    body: `${
                        modifiedDescription ?? ""
                    }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`,
                    assignees: [
                        data.assigneeId && assignee?.githubUsername
                            ? assignee?.githubUsername
                            : ""
                    ]
                })
                .send();

            if (createdIssueResponse.statusCode > 201) {
                console.log(
                    `Failed to create GitHub issue for ${data.team.key}-${
                        data.number
                    }, received status code ${
                        createdIssueResponse.statusCode
                    }, body of ${formatJSON(createdIssueResponse.json())}.`
                );

                throw new ApiError(
                    `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`,
                    500
                );
            }

            const createdIssueData: components["schemas"]["issue"] =
                await createdIssueResponse.json();

            const attachmentQuery = getAttachmentQuery(
                data.id,
                createdIssueData.number,
                repoFullName
            );

            console.log(attachmentQuery, createdIssueData);

            await Promise.all([
                linearQuery(attachmentQuery, linearKey).then(response => {
                    if (!response?.data?.attachmentCreate?.success) {
                        console.log(
                            `Failed to create attachment on ${ticketName} for GitHub issue #${
                                createdIssueData.number
                            }, received response ${
                                response?.error ?? response?.data ?? ""
                            }.`
                        );
                    } else {
                        console.log(
                            `Created attachment on ${ticketName} for GitHub issue #${createdIssueData.number}.`
                        );
                    }
                }),
                prisma.syncedIssue.create({
                    data: {
                        githubIssueId: createdIssueData.id,
                        linearIssueId: data.id,
                        linearTeamId: data.teamId,
                        githubIssueNumber: createdIssueData.number,
                        linearIssueNumber: data.number,
                        githubRepoId: repoId
                    }
                })
            ] as Promise<any>[]);

            // Apply all labels to newly-created issue
            const labelIds = data.labelIds.filter(id => id != publicLabelId);
            const labelNames: string[] = [];
            for (const labelId of labelIds) {
                if (labelId === publicLabelId) continue;

                const label = await linear.issueLabel(labelId);
                if (!label) {
                    console.log(
                        `Could not find label ${labelId} for ${ticketName}.`
                    );
                    continue;
                }

                const createdLabelResponse = await petitio(
                    `https://api.github.com/repos/${repoFullName}/labels`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        name: label.name,
                        color: label.color?.replace("#", ""),
                        description: "Created by Linear-GitHub Sync"
                    })
                    .send();

                const createdLabelData = await createdLabelResponse.json();

                if (
                    createdLabelResponse.statusCode > 201 &&
                    createdLabelData.errors?.[0]?.code !== "already_exists"
                ) {
                    console.log(
                        `Could not create GH label "${label.name}" in ${repoFullName}.`
                    );
                    continue;
                }

                const labelName =
                    createdLabelData.errors?.[0]?.code === "already_exists"
                        ? label.name
                        : createdLabelData.name;

                labelNames.push(labelName);
            }

            // Add priority label if applicable
            if (!!data.priority && SHARED.PRIORITY_LABELS[data.priority]) {
                const priorityLabel = SHARED.PRIORITY_LABELS[data.priority];
                const createdLabelResponse = await petitio(
                    `https://api.github.com/repos/${repoFullName}/labels`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        name: priorityLabel.name,
                        color: priorityLabel.color?.replace("#", ""),
                        description: "Created by Linear-GitHub Sync"
                    })
                    .send();
                const createdLabelData = await createdLabelResponse.json();

                if (
                    createdLabelResponse.statusCode > 201 &&
                    createdLabelData.errors?.[0]?.code !== "already_exists"
                ) {
                    console.log(
                        `Could not create priority label "${priorityLabel.name}" in ${repoFullName}.`
                    );
                } else {
                    const labelName =
                        createdLabelData.errors?.[0]?.code === "already_exists"
                            ? priorityLabel.name
                            : createdLabelData.name;

                    labelNames.push(labelName);
                }
            }

            const appliedLabelResponse = await petitio(
                `${issuesEndpoint}/${createdIssueData.number}/labels`,
                "POST"
            )
                .header("User-Agent", userAgentHeader)
                .header("Authorization", githubAuthHeader)
                .body({ labels: labelNames })
                .send();

            if (appliedLabelResponse.statusCode > 201) {
                console.log(
                    `Could not apply labels to #${createdIssueData.number} in ${repoFullName}.`
                );
            } else {
                console.log(
                    `Applied labels to #${createdIssueData.number} in ${repoFullName}.`
                );
            }

            if (!syncs.some(sync => sync.linearUserId === data.creatorId)) {
                await inviteMember(
                    data.creatorId,
                    data.teamId,
                    repoFullName,
                    linear
                );
            }
        }
    }

    if (actionType === "Project") {
        console.log("Project event received.");
    }
}
