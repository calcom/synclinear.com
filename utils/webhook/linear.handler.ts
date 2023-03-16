import { GITHUB, LINEAR, SHARED } from "../constants";
import { LinearWebhookPayload, MilestoneState } from "../../typings";
import prisma from "../../prisma";
import {
    decrypt,
    formatJSON,
    getAttachmentQuery,
    getSyncFooter,
    isNumber,
    skipReason
} from "../index";
import { LinearClient } from "@linear/sdk";
import {
    applyLabel,
    createLabel,
    replaceMentions,
    upsertUser
} from "../../pages/api/utils";
import got from "got";
import { getLinearCycle, inviteMember } from "../linear";
import { components } from "@octokit/openapi-types";
import { linearQuery } from "../apollo";
import { createMilestone, getGitHubFooter, setIssueMilestone } from "../github";
import { ApiError, getIssueUpdateError, getOtherUpdateError } from "../errors";

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

    const sync = syncs.find(sync => {
        // For comment events the teamId property from linear is not passed,
        // so we fallback to only match on user
        const isTeamMatching = data.teamId
            ? sync.linearTeamId === data.teamId
            : true;
        const isUserMatching =
            sync.linearUserId === (data.userId ?? data.creatorId);

        return isUserMatching && isTeamMatching;
    });

    if (syncs.length === 0 || !sync) {
        console.log("Could not find Linear user in syncs.");
        return "Could not find Linear user in syncs.";
    }

    if (!sync?.LinearTeam || !sync?.GitHubRepo) {
        console.log("Could not find ticket's corresponding repo.");
        throw new ApiError("Could not find ticket's corresponding repo.", 404);
    }

    const {
        linearUserId,
        linearTeamId,
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

                const removedLabelResponse = await got.delete(
                    `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels/${label.name}`,
                    {
                        headers: {
                            Authorization: githubAuthHeader,
                            "User-Agent": userAgentHeader
                        }
                    }
                );

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

                const { createdLabel, error: createLabelError } =
                    await createLabel({
                        repoFullName,
                        label,
                        githubAuthHeader,
                        userAgentHeader
                    });

                if (createLabelError) {
                    console.log("Could not create label.");
                    throw new ApiError("Could not create label.", 403);
                }

                const labelName = createdLabel ? createdLabel.name : label.name;

                const { error: applyLabelError } = await applyLabel({
                    repoFullName: syncedIssue.GitHubRepo.repoName,
                    issueNumber: syncedIssue.githubIssueNumber,
                    labelNames: [labelName],
                    githubAuthHeader,
                    userAgentHeader
                });

                if (applyLabelError) {
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

            const createdIssueResponse = await got.post(issuesEndpoint, {
                json: {
                    title: `[${ticketName}] ${data.title}`,
                    body: `${
                        modifiedDescription ?? ""
                    }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`,
                    assignees: [
                        data.assigneeId && assignee?.githubUsername
                            ? assignee?.githubUsername
                            : ""
                    ]
                },
                headers: {
                    Authorization: githubAuthHeader,
                    "User-Agent": userAgentHeader
                }
            });

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
                        JSON.parse(createdIssueResponse.body)
                    )}.`
                );

                throw new ApiError(
                    `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`,
                    500
                );
            }

            let createdIssueData: components["schemas"]["issue"] = JSON.parse(
                createdIssueResponse.body
            );

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

                const { createdLabel, error } = await createLabel({
                    repoFullName,
                    label,
                    githubAuthHeader,
                    userAgentHeader
                });

                if (error) {
                    console.log(
                        `Could not create GH label "${label.name}" in ${repoFullName}.`
                    );
                    continue;
                }

                const labelName = createdLabel ? createdLabel.name : label.name;

                labelNames.push(labelName);
            }

            // Add priority label if applicable
            if (!!data.priority && SHARED.PRIORITY_LABELS[data.priority]) {
                const priorityLabel = SHARED.PRIORITY_LABELS[data.priority];
                const { createdLabel, error } = await createLabel({
                    repoFullName,
                    label: priorityLabel,
                    githubAuthHeader,
                    userAgentHeader
                });

                if (error) {
                    console.log(
                        `Could not create priority label "${priorityLabel.name}" in ${repoFullName}.`
                    );
                } else {
                    const labelName = createdLabel
                        ? createdLabel.name
                        : priorityLabel.name;

                    labelNames.push(labelName);
                }
            }

            const { error: applyLabelError } = await applyLabel({
                repoFullName,
                issueNumber: createdIssueData.number,
                labelNames,
                githubAuthHeader,
                userAgentHeader
            });

            if (applyLabelError) {
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
                const footer = getGitHubFooter(user.displayName);

                const commentResponse = await got.post(
                    `${issuesEndpoint}/${createdIssueData.number}/comments`,
                    {
                        json: { body: `${modifiedComment || ""}${footer}` },
                        headers: {
                            Authorization: githubAuthHeader,
                            "User-Agent": userAgentHeader
                        }
                    }
                );

                if (commentResponse.statusCode > 201) {
                    console.log(
                        getOtherUpdateError(
                            "comment",
                            data,
                            createdIssueData,
                            createdIssueResponse,
                            JSON.parse(commentResponse.body)
                        )
                    );
                } else {
                    console.log(
                        `Created comment on GitHub issue #${createdIssueData.number} [${createdIssueData.id}] for Linear issue ${ticketName}.`
                    );
                }
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
            const updatedIssueResponse = await got.patch(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                {
                    json: { title: `[${ticketName}] ${data.title}` },
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    }
                }
            );

            if (updatedIssueResponse.statusCode > 201) {
                console.log(
                    getIssueUpdateError(
                        "title",
                        data,
                        syncedIssue,
                        updatedIssueResponse
                    )
                );
            } else {
                console.log(
                    `Updated GitHub issue title for ${ticketName} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                );
            }
        }

        // Description change
        if (updatedFrom.description && actionType === "Issue") {
            const modifiedDescription = await replaceMentions(
                data.description,
                "linear"
            );

            const updatedIssueResponse = await got.patch(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                {
                    json: {
                        body: `${
                            modifiedDescription ?? ""
                        }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`
                    },
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    }
                }
            );

            if (updatedIssueResponse.statusCode > 201) {
                console.log(
                    getIssueUpdateError(
                        "description",
                        data,
                        syncedIssue,
                        updatedIssueResponse
                    )
                );
            } else {
                console.log(
                    `Updated GitHub issue description for ${ticketName} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                );
            }
        }

        // Cycle change
        if ("cycleId" in updatedFrom && actionType === "Issue") {
            if (!syncedIssue) {
                const reason = skipReason("milestone", ticketName);
                console.log(reason);
                return reason;
            }

            if (!data.cycleId) {
                const response = await setIssueMilestone(
                    githubKey,
                    syncedIssue.GitHubRepo.repoName,
                    syncedIssue.githubIssueNumber,
                    null
                );

                if (response.status > 201) {
                    const reason = `Could not remove milestone for ${ticketName}.`;
                    console.log(reason);
                    throw new ApiError(reason, 500);
                } else {
                    const reason = `Removed milestone for ${ticketName}.`;
                    console.log(reason);
                    return reason;
                }
            }

            let syncedMilestone = await prisma.milestone.findFirst({
                where: {
                    cycleId: data.cycleId,
                    linearTeamId: linearTeamId
                }
            });

            if (!syncedMilestone) {
                const cycleResponse = await getLinearCycle(
                    linearKey,
                    data.cycleId
                );
                const cycle = await cycleResponse?.data?.cycle;

                if (!cycle) {
                    const reason = `Could not find cycle for ${ticketName}.`;
                    console.log(reason);
                    throw new ApiError(reason, 500);
                }

                // Skip if cycle was created by bot but not yet synced
                if (cycle.description?.includes(getSyncFooter())) {
                    const reason = `Skipping over cycle "${cycle.name}" because it is caused by sync`;
                    console.log(reason);
                    return reason;
                }

                const title = !cycle.name
                    ? `v.${cycle.number}`
                    : isNumber(cycle.name)
                    ? `v.${cycle.name}`
                    : cycle.name;
                const today = new Date();
                const state: MilestoneState =
                    new Date(cycle.endsAt) > today ? "open" : "closed";

                const createdMilestone = await createMilestone(
                    githubKey,
                    syncedIssue.GitHubRepo.repoName,
                    title,
                    `${cycle.description}\n\n> ${getSyncFooter()}`,
                    state
                );

                if (!createdMilestone?.milestoneId) {
                    const reason = `Could not create milestone for ${ticketName}.`;
                    console.log(reason);
                    throw new ApiError(reason, 500);
                }

                syncedMilestone = await prisma.milestone.create({
                    data: {
                        milestoneId: createdMilestone.milestoneId,
                        cycleId: data.cycleId,
                        linearTeamId: linearTeamId,
                        githubRepoId: syncedIssue.githubRepoId
                    }
                });
            }

            const response = await setIssueMilestone(
                githubKey,
                syncedIssue.GitHubRepo.repoName,
                syncedIssue.githubIssueNumber,
                syncedMilestone.milestoneId
            );

            if (response.status > 201) {
                const reason = `Could not add milestone for ${ticketName}.`;
                console.log(reason);
                throw new ApiError(reason, 500);
            } else {
                const reason = `Added milestone to #${syncedIssue.githubIssueNumber} for ${ticketName}.`;
                console.log(reason);
                return reason;
            }
        }

        // State change (eg. "Open" to "Done")
        if (updatedFrom.stateId) {
            const state = [doneStateId, canceledStateId].includes(data.stateId)
                ? "closed"
                : "open";
            const reason =
                doneStateId === data.stateId ? "completed" : "not_planned";

            const updatedIssueResponse = await got.patch(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                {
                    json: { state, state_reason: reason },
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    }
                }
            );

            if (updatedIssueResponse.statusCode > 201) {
                console.log(
                    getIssueUpdateError(
                        "state",
                        data,
                        syncedIssue,
                        updatedIssueResponse
                    )
                );
            } else {
                console.log(
                    `Updated GitHub issue state for ${ticketName} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                );
            }
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
                const response = await got.post(assigneeEndpoint, {
                    json: {
                        assignees: [assignee.githubUsername]
                    },
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    }
                });

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
                    const response = await got.delete(assigneeEndpoint, {
                        json: {
                            assignees: [prevAssignee.githubUsername]
                        },
                        headers: {
                            Authorization: githubAuthHeader,
                            "User-Agent": userAgentHeader
                        }
                    });

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
            const removedLabelResponse = await got.delete(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels/${prevPriorityLabel.name}`,
                {
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    }
                }
            );

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
            const { createdLabel, error } = await createLabel({
                repoFullName,
                label: priorityLabel,
                githubAuthHeader,
                userAgentHeader
            });

            if (error) {
                console.log("Could not create label.");
                throw new ApiError("Could not create label.", 403);
            }

            const labelName = createdLabel
                ? createdLabel.name
                : priorityLabel.name;

            const { error: applyLabelError } = await applyLabel({
                repoFullName: syncedIssue.GitHubRepo.repoName,
                issueNumber: syncedIssue.githubIssueNumber,
                labelNames: [labelName],
                githubAuthHeader,
                userAgentHeader
            });

            if (applyLabelError) {
                console.log("Could not apply label.");
                throw new ApiError("Could not apply label.", 403);
            } else {
                console.log(
                    `Applied priority label "${labelName}" to issue #${syncedIssue.githubIssueNumber}.`
                );
            }
        }

        if ("estimate" in updatedFrom) {
            // Remove old estimate label
            const prevLabelName = `${updatedFrom["estimate"]} points`;

            const removedLabelResponse = await got.delete(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels/${prevLabelName}`,
                {
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    },
                    throwHttpErrors: false
                }
            );

            if (removedLabelResponse.statusCode > 201) {
                console.log(
                    `Did not remove estimate label "${prevLabelName}".`
                );
            } else {
                console.log(
                    `Removed estimate "${prevLabelName}" from issue #${syncedIssue.githubIssueNumber}.`
                );
            }

            if (!data["estimate"]) {
                return `Removed estimate label "${prevLabelName}" from issue #${syncedIssue.githubIssueNumber}.`;
            }

            // Create new estimate label if not yet existent
            const estimateLabel = {
                name: `${data["estimate"]} points`,
                color: "666"
            };

            const { createdLabel, error } = await createLabel({
                repoFullName,
                label: estimateLabel,
                githubAuthHeader,
                userAgentHeader
            });

            if (error) {
                console.log("Could not create estimate label.");
                throw new ApiError("Could not create estimate label.", 403);
            }

            const labelName = createdLabel
                ? createdLabel.name
                : estimateLabel.name;

            const { error: applyLabelError } = await applyLabel({
                repoFullName: syncedIssue.GitHubRepo.repoName,
                issueNumber: syncedIssue.githubIssueNumber,
                labelNames: [labelName],
                githubAuthHeader,
                userAgentHeader
            });

            if (applyLabelError) {
                console.log("Could not apply label.");
                throw new ApiError("Could not apply label.", 403);
            } else {
                console.log(
                    `Applied estimate label "${labelName}" to issue #${syncedIssue.githubIssueNumber}.`
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
            const footer = getGitHubFooter(data.user?.name);

            const commentResponse = await got.post(
                `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/comments`,
                {
                    json: { body: `${modifiedBody || ""}${footer}` },
                    headers: {
                        Authorization: githubAuthHeader,
                        "User-Agent": userAgentHeader
                    }
                }
            );

            if (commentResponse.statusCode > 201) {
                console.log(
                    `Failed to update GitHub issue state for ${
                        data.issue?.id
                    } on GitHub issue #${syncedIssue.githubIssueNumber} [${
                        syncedIssue.githubIssueId
                    }], received status code ${
                        commentResponse.statusCode
                    }, body of ${formatJSON(JSON.parse(commentResponse.body))}.`
                );
            } else {
                console.log(
                    `Synced comment [${data.id}] for ${data.issue?.id} on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                );
            }
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

            const createdIssueResponse = await got.post(issuesEndpoint, {
                headers: {
                    Authorization: githubAuthHeader,
                    "User-Agent": userAgentHeader
                },
                json: {
                    title: `[${ticketName}] ${data.title}`,
                    body: `${
                        modifiedDescription ?? ""
                    }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`,
                    assignees: [
                        data.assigneeId && assignee?.githubUsername
                            ? assignee?.githubUsername
                            : ""
                    ]
                }
            });

            if (createdIssueResponse.statusCode > 201) {
                console.log(
                    `Failed to create GitHub issue for ${data.team.key}-${
                        data.number
                    }, received status code ${
                        createdIssueResponse.statusCode
                    }, body of ${formatJSON(
                        JSON.parse(createdIssueResponse.body)
                    )}.`
                );

                throw new ApiError(
                    `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`,
                    500
                );
            }

            const createdIssueData: components["schemas"]["issue"] = JSON.parse(
                createdIssueResponse.body
            );

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

                const { createdLabel, error } = await createLabel({
                    repoFullName,
                    label,
                    githubAuthHeader,
                    userAgentHeader
                });

                if (error) {
                    console.log(
                        `Could not create GH label "${label.name}" in ${repoFullName}.`
                    );
                    continue;
                }

                const labelName = createdLabel ? createdLabel.name : label.name;

                labelNames.push(labelName);
            }

            // Add priority label if applicable
            if (!!data.priority && SHARED.PRIORITY_LABELS[data.priority]) {
                const priorityLabel = SHARED.PRIORITY_LABELS[data.priority];

                const { createdLabel, error } = await createLabel({
                    repoFullName,
                    label: priorityLabel,
                    githubAuthHeader,
                    userAgentHeader
                });

                if (error) {
                    console.log(
                        `Could not create priority label "${priorityLabel.name}" in ${repoFullName}.`
                    );
                } else {
                    const labelName = createdLabel
                        ? createdLabel.name
                        : priorityLabel.name;

                    labelNames.push(labelName);
                }
            }

            const { error: applyLabelError } = await applyLabel({
                repoFullName,
                issueNumber: createdIssueData.number,
                labelNames,
                githubAuthHeader,
                userAgentHeader
            });

            if (applyLabelError) {
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
}
