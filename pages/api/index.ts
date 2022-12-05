import petitio from "petitio";
import { components } from "@octokit/openapi-types";
import { LinearWebhookPayload } from "../../typings";
import { createHmac, timingSafeEqual } from "crypto";
import { IssueCommentCreatedEvent, IssuesEvent } from "@octokit/webhooks-types";
import { LinearClient } from "@linear/sdk";
import prisma from "../../prisma";
import { NextApiRequest, NextApiResponse } from "next";
import {
    decrypt,
    formatJSON,
    getAttachmentQuery,
    getSyncFooter,
    skipReason,
    replaceImgTags
} from "../../utils";
import { getGitHubFooter } from "../../utils/github";
import { generateLinearUUID, inviteMember } from "../../utils/linear";
import { GITHUB, LINEAR, SHARED } from "../../utils/constants";
import { getIssueUpdateError, getOtherUpdateError } from "../../utils/errors";
import { replaceMentions, upsertUser } from "./utils";
import { linearQuery } from "../../utils/apollo";

export default async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") {
        return res.status(405).send({
            success: false,
            message: "Only POST requests are accepted."
        });
    }

    /**
     * Linear webhook consumer
     */
    if (req.headers["user-agent"] === "Linear-Webhook") {
        if (
            !LINEAR.IP_ORIGINS.includes(
                `${req.headers["x-forwarded-for"] || ""}`
            )
        ) {
            console.log("Could not verify Linear webhook.");
            return res.status(403).send({
                success: false,
                message: "Could not verify Linear webhook."
            });
        }

        const {
            action,
            updatedFrom,
            data,
            url,
            type: actionType
        }: LinearWebhookPayload = req.body;

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
            return res.status(200).send({
                success: true,
                message: "Could not find Linear user in syncs."
            });
        }

        const sync = syncs.find(
            sync =>
                sync.linearUserId === (data.userId ?? data.creatorId) &&
                sync.linearTeamId === data.teamId
        );

        if (!sync?.LinearTeam || !sync?.GitHubRepo) {
            console.log("Could not find ticket's corresponding repo.");

            return res.status(404).send({
                success: false,
                message: "Could not find ticket's corresponding repo."
            });
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
                    return res.status(200).send({
                        success: true,
                        message: skipReason("label", ticketName)
                    });
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
                        return res.status(200).send({
                            success: true,
                            message: reason
                        });
                    }

                    const label = await linear.issueLabel(removedLabelId);
                    if (!label) {
                        return res.status(403).send({
                            success: false,
                            message: "Could not find label."
                        });
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
                        return res.status(403).send({
                            success: false,
                            message: `Could not remove label "${label.name}".`
                        });
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
                        return res.status(403).send({
                            success: false,
                            message: "Could not find label."
                        });
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
                        return res.status(403).send({
                            success: false,
                            message: "Could not create label."
                        });
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
                        return res.status(403).send({
                            success: false,
                            message: "Could not apply label."
                        });
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

                    return res.status(200).send({
                        success: true,
                        message: "Issue already exists on GitHub."
                    });
                }

                const modifiedDescription = await replaceMentions(
                    data.description,
                    "linear"
                );

                const assignee = await prisma.user.findFirst({
                    where: { linearUserId: data.assigneeId },
                    select: { githubUsername: true }
                });

                const createdIssueResponse = await petitio(
                    issuesEndpoint,
                    "POST"
                )
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
                            sync.linearUserId ===
                            (data.userId ?? data.creatorId)
                    )
                ) {
                    inviteMember(
                        data.creatorId,
                        data.teamId,
                        repoFullName,
                        linear
                    );
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

                    return res.status(500).send({
                        success: false,
                        message: `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`
                    });
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
                const labelIds = data.labelIds.filter(
                    id => id != publicLabelId
                );
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
                            createdLabelData.errors?.[0]?.code ===
                            "already_exists"
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
                const linearComments = await linearIssue
                    .comments()
                    .then(comments =>
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
                return res.status(200).send({ success: true, message: reason });
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
                        state: [doneStateId, canceledStateId].includes(
                            data.stateId
                        )
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
                        const response = await petitio(
                            assigneeEndpoint,
                            "DELETE"
                        )
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
                    return res.status(403).send({
                        success: false,
                        message: reason
                    });
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
                    return res.status(200).send({
                        success: true,
                        message: `Removed priority label "${prevPriorityLabel.name}" from issue #${syncedIssue.githubIssueNumber}.`
                    });
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
                    return res.status(403).send({
                        success: false,
                        message: "Could not create label."
                    });
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
                    return res.status(403).send({
                        success: false,
                        message: "Could not apply label."
                    });
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

                    return res.status(200).send({
                        success: true,
                        message: skipReason("comment", data.issue!.id, true)
                    });
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
                        skipReason(
                            "comment",
                            `${data.team?.key}-${data.number}`
                        )
                    );

                    return res.status(200).send({
                        success: true,
                        message: skipReason(
                            "comment",
                            `${data.team?.key}-${data.number}`
                        )
                    });
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
                                }, body of ${formatJSON(
                                    commentResponse.json()
                                )}.`
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
                    return res.status(200).send({
                        success: true,
                        message: reason
                    });
                }

                if (syncedIssue) {
                    const reason = `Not creating issue after label added as issue ${ticketName} already exists on GitHub as #${syncedIssue.githubIssueNumber}.`;
                    console.log(reason);
                    return res.status(200).send({
                        success: true,
                        message: reason
                    });
                }

                if (data.id?.includes(GITHUB.UUID_SUFFIX)) {
                    const reason = skipReason("issue", data.id, true);
                    console.log(reason);
                    return res.status(200).send({
                        success: true,
                        message: reason
                    });
                }

                const modifiedDescription = await replaceMentions(
                    data.description,
                    "linear"
                );

                const assignee = await prisma.user.findFirst({
                    where: { linearUserId: data.assigneeId },
                    select: { githubUsername: true }
                });

                const createdIssueResponse = await petitio(
                    issuesEndpoint,
                    "POST"
                )
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

                    return res.status(500).send({
                        success: false,
                        message: `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`
                    });
                }

                const createdIssueData: components["schemas"]["issue"] =
                    await createdIssueResponse.json();

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
                const labelIds = data.labelIds.filter(
                    id => id != publicLabelId
                );
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
                            createdLabelData.errors?.[0]?.code ===
                            "already_exists"
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

        /**
         * GitHub webhook consumer
         */
    } else {
        const { repository, sender, action } = req.body;

        const sync = await prisma.sync.findFirst({
            where: {
                githubRepoId: repository.id,
                githubUserId: sender.id
            },
            include: {
                GitHubRepo: true,
                LinearTeam: true
            }
        });

        if (!sync?.LinearTeam || !sync?.GitHubRepo) {
            console.log("Could not find issue's corresponding team.");

            return res.status(404).send({
                success: false,
                message: "Could not find issue's corresponding team."
            });
        }

        const HMAC = createHmac("sha256", sync.GitHubRepo?.webhookSecret ?? "");
        const digest = Buffer.from(
            `sha256=${HMAC.update(JSON.stringify(req.body)).digest("hex")}`,
            "utf-8"
        );
        const sig = Buffer.from(
            req.headers["x-hub-signature-256"] as string,
            "utf-8"
        );

        if (sig.length !== digest.length || !timingSafeEqual(digest, sig)) {
            console.log("Failed to verify signature for webhook.");

            return res.status(403).send({
                success: false,
                message: "GitHub webhook secret doesn't match up."
            });
        }

        const {
            linearUserId,
            linearApiKey,
            linearApiKeyIV,
            githubUserId,
            githubApiKey,
            githubApiKeyIV,
            LinearTeam: {
                publicLabelId,
                doneStateId,
                toDoStateId,
                canceledStateId,
                teamId: linearTeamId
            },
            GitHubRepo: { repoName }
        } = sync;

        const linearKey = process.env.LINEAR_API_KEY
            ? process.env.LINEAR_API_KEY
            : decrypt(linearApiKey, linearApiKeyIV);

        const linear = new LinearClient({
            apiKey: linearKey
        });

        const githubKey = process.env.GITHUB_API_KEY
            ? process.env.GITHUB_API_KEY
            : decrypt(githubApiKey, githubApiKeyIV);

        const githubAuthHeader = `token ${githubKey}`;
        const userAgentHeader = `${repoName}, linear-github-sync`;
        const issuesEndpoint = `https://api.github.com/repos/${repoName}/issues`;

        // Map the user's GitHub username to their Linear username if not yet mapped
        await upsertUser(
            linear,
            githubUserId,
            linearUserId,
            userAgentHeader,
            githubAuthHeader
        );

        const { issue }: IssuesEvent = req.body;

        const syncedIssue = await prisma.syncedIssue.findFirst({
            where: {
                githubIssueNumber: issue?.number,
                githubRepoId: repository.id
            }
        });

        if (
            req.headers["x-github-event"] === "issue_comment" &&
            action === "created"
        ) {
            // Comment created

            const { comment }: IssueCommentCreatedEvent = req.body;

            if (comment.body.includes("on Linear")) {
                console.log(skipReason("comment", issue.number, true));

                return res.status(200).send({
                    success: true,
                    message: skipReason("comment", issue.number, true)
                });
            }

            if (!syncedIssue) {
                const reason = skipReason("comment", issue.number);
                console.log(reason);
                return res.status(200).send({
                    success: true,
                    message: reason
                });
            }

            let modifiedComment = await replaceMentions(comment.body, "github");
            modifiedComment = replaceImgTags(modifiedComment);

            await linear
                .commentCreate({
                    id: generateLinearUUID(),
                    issueId: syncedIssue.linearIssueId,
                    body: modifiedComment ?? ""
                })
                .then(comment => {
                    comment.comment?.then(commentData => {
                        commentData.issue?.then(issueData => {
                            issueData.team?.then(teamData => {
                                if (!comment.success)
                                    console.log(
                                        `Failed to create comment for ${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueNumber}] for GitHub issue #${issue.number} [${issue.id}].`
                                    );
                                else
                                    console.log(
                                        `Created comment for ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${issue.number} [${issue.id}].`
                                    );
                            });
                        });
                    });
                });
        }

        // Ensure the event is for an issue
        if (req.headers["x-github-event"] !== "issues") {
            console.log("Not an issue event.");
            return res.status(200).send({
                success: true,
                message: "Not an issue event."
            });
        }

        if (action === "edited") {
            // Issue edited

            if (!syncedIssue) {
                const reason = skipReason("edit", issue.number);
                console.log(reason);
                return res.status(200).send({
                    success: true,
                    message: reason
                });
            }

            const title = issue.title.split(
                `${syncedIssue.linearIssueNumber}]`
            );
            if (title.length > 1) title.shift();

            const description = issue.body?.split("<sub>");
            if ((description?.length || 0) > 1) description?.pop();

            let modifiedDescription = await replaceMentions(
                description?.join("<sub>"),
                "github"
            );
            modifiedDescription = replaceImgTags(modifiedDescription);

            await linear
                .issueUpdate(syncedIssue.linearIssueId, {
                    title: title.join(`${syncedIssue.linearIssueNumber}]`),
                    description: modifiedDescription
                })
                .then(updatedIssue => {
                    updatedIssue.issue?.then(updatedIssueData => {
                        updatedIssueData.team?.then(teamData => {
                            if (!updatedIssue.success)
                                console.log(
                                    `Failed to edit issue for ${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueNumber}] for GitHub issue #${issue.number} [${issue.id}].`
                                );
                            else
                                console.log(
                                    `Edited issue ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${issue.number} [${issue.id}].`
                                );
                        });
                    });
                });
        } else if (["closed", "reopened"].includes(action)) {
            // Issue closed or reopened

            if (!syncedIssue) {
                const reason = skipReason("edit", issue.number);
                console.log(reason);
                return res.status(200).send({
                    success: true,
                    message: reason
                });
            }

            await linear
                .issueUpdate(syncedIssue.linearIssueId, {
                    stateId:
                        issue.state_reason === "not_planned"
                            ? canceledStateId
                            : issue.state_reason === "completed"
                            ? doneStateId
                            : toDoStateId
                })
                .then(updatedIssue => {
                    updatedIssue.issue?.then(updatedIssueData => {
                        updatedIssueData.team?.then(teamData => {
                            if (!updatedIssue.success)
                                console.log(
                                    `Failed to change state for ${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueNumber}] for GitHub issue #${issue.number} [${issue.id}].`
                                );
                            else
                                console.log(
                                    `Changed state ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${issue.number} [${issue.id}].`
                                );
                        });
                    });
                });
        } else if (
            action === "opened" ||
            (action === "labeled" &&
                req.body.label?.name?.toLowerCase() === LINEAR.GITHUB_LABEL)
        ) {
            // Issue opened or special "linear" label added

            if (syncedIssue) {
                const reason = `Not creating ticket as issue ${issue.number} already exists on Linear as ${syncedIssue.linearIssueNumber}.`;
                console.log(reason);
                return res.status(200).send({
                    success: true,
                    message: reason
                });
            }

            let modifiedDescription = await replaceMentions(
                issue.body,
                "github"
            );
            modifiedDescription = replaceImgTags(modifiedDescription);

            const assignee = await prisma.user.findFirst({
                where: { githubUserId: issue.assignee?.id },
                select: { linearUserId: true }
            });

            const createdIssueData = await linear.issueCreate({
                id: generateLinearUUID(),
                title: issue.title,
                description: `${modifiedDescription ?? ""}`,
                teamId: linearTeamId,
                labelIds: [publicLabelId],
                assigneeId:
                    issue.assignee?.id && assignee
                        ? assignee.linearUserId
                        : null
            });

            if (!createdIssueData.success) {
                const reason = `Failed to create ticket for GitHub issue #${issue.number}.`;
                console.log(reason);
                return res.status(500).send({
                    success: false,
                    message: reason
                });
            }

            const createdIssue = await createdIssueData.issue;

            if (!createdIssue)
                console.log(
                    `Failed to fetch ticket I just created for GitHub issue #${issue.number}.`
                );
            else {
                const team = await createdIssue.team;

                if (!team) {
                    console.log(
                        `Failed to fetch team for ticket, ${createdIssue.id} for GitHub issue #${issue.number}.`
                    );
                } else {
                    const ticketName = `${team.key}-${createdIssue.number}`;
                    const attachmentQuery = getAttachmentQuery(
                        createdIssue.id,
                        issue.number,
                        repoName
                    );

                    await Promise.all([
                        petitio(`${issuesEndpoint}/${issue.number}`, "PATCH")
                            .header("User-Agent", userAgentHeader)
                            .header("Authorization", githubAuthHeader)
                            .body({
                                title: `[${ticketName}] ${issue.title}`,
                                body: `${issue.body}\n\n<sub>[${ticketName}](${createdIssue.url})</sub>`
                            })
                            .send()
                            .then(titleRenameResponse => {
                                if (titleRenameResponse.statusCode > 201)
                                    console.log(
                                        `Failed to update GitHub issue title for ${ticketName} on GitHub issue #${
                                            issue.number
                                        }, received status code ${
                                            titleRenameResponse.statusCode
                                        }, body of ${formatJSON(
                                            titleRenameResponse.json()
                                        )}.`
                                    );
                                else
                                    console.log(
                                        `Created comment on GitHub issue #${issue.number} for Linear issue ${ticketName}.`
                                    );
                            }),
                        linearQuery(attachmentQuery, linearKey).then(
                            response => {
                                if (
                                    !response?.data?.attachmentCreate?.success
                                ) {
                                    console.log(
                                        `Failed to create attachment on ${ticketName} for GitHub issue #${
                                            issue.number
                                        }, received response ${
                                            response?.error ??
                                            response?.data ??
                                            ""
                                        }.`
                                    );
                                } else {
                                    console.log(
                                        `Created attachment on ${ticketName} for GitHub issue #${issue.number}.`
                                    );
                                }
                            }
                        ),
                        prisma.syncedIssue.create({
                            data: {
                                githubIssueNumber: issue.number,
                                githubIssueId: issue.id,
                                linearIssueId: createdIssue.id,
                                linearIssueNumber: createdIssue.number,
                                linearTeamId: team.id,
                                githubRepoId: repository.id
                            }
                        })
                    ]);
                }
            }

            // Add issue comment history to newly-created Linear ticket
            if (action === "labeled") {
                const issueCommentsPayload = await petitio(
                    `${issuesEndpoint}/${issue.number}/comments`,
                    "GET"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .send();

                if (issueCommentsPayload.statusCode > 201) {
                    console.log(
                        `Failed to fetch comments for GitHub issue #${
                            issue.number
                        } [${issue.id}], received status code ${
                            issueCommentsPayload.statusCode
                        }, body of ${formatJSON(issueCommentsPayload.json())}.`
                    );

                    return res.status(403).send({
                        message: `Could not fetch comments for GitHub issue #${issue.number} [${issue.id}]`
                    });
                }

                const comments = await issueCommentsPayload.json();

                for (const comment of comments) {
                    let modifiedComment = await replaceMentions(
                        comment.body,
                        "github"
                    );
                    modifiedComment = replaceImgTags(modifiedComment);

                    const commentData = await linear.commentCreate({
                        id: generateLinearUUID(),
                        issueId: createdIssue.id,
                        body: modifiedComment ?? ""
                    });

                    if (!commentData.success) {
                        console.log(
                            `Failed to create comment on Linear ticket ${createdIssue.id} for GitHub issue #${issue.number}.`
                        );

                        return res.status(500).send({
                            success: false,
                            message: `Failed creating comment on Linear.`
                        });
                    }
                }
            }
        } else if (["assigned", "unassigned"].includes(action)) {
            // Assignee changed

            if (!syncedIssue) {
                const reason = skipReason("assignee", issue.number);
                console.log(reason);
                return res.status(200).send({
                    success: true,
                    message: reason
                });
            }

            const { assignee } = issue;

            if (!assignee?.id) {
                // Remove assignee

                const response = await linear.issueUpdate(
                    syncedIssue.linearIssueId,
                    { assigneeId: null }
                );

                if (!response?.success) {
                    const reason = `Failed to remove assignee on Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    return res.status(500).send({
                        success: false,
                        message: reason
                    });
                } else {
                    const reason = `Removed assignee from Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    return res.status(200).send({
                        success: true,
                        message: reason
                    });
                }
            } else {
                // Add assignee

                const user = await prisma.user.findFirst({
                    where: { githubUserId: assignee?.id },
                    select: { linearUserId: true }
                });

                if (!user) {
                    const reason = `Skipping assignee change for issue #${issue.number} as no Linear username was found for GitHub user ${assignee?.login}.`;
                    console.log(reason);
                    return res.status(200).send({
                        success: true,
                        message: reason
                    });
                }

                const response = await linear.issueUpdate(
                    syncedIssue.linearIssueId,
                    { assigneeId: user.linearUserId }
                );

                if (!response?.success) {
                    const reason = `Failed to add assignee on Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    return res.status(500).send({
                        success: false,
                        message: reason
                    });
                } else {
                    const reason = `Added assignee to Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    return res.status(200).send({
                        success: true,
                        message: reason
                    });
                }
            }
        }
    }

    console.log("Webhook received.");

    return res.status(200).send({
        success: true,
        message: "Webhook received."
    });
};
