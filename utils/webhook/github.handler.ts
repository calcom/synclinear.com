import prisma from "../../prisma";
import { createHmac, timingSafeEqual } from "crypto";
import {
    decrypt,
    getAttachmentQuery,
    getSyncFooter,
    skipReason
} from "../index";
import { LinearClient } from "@linear/sdk";
import {
    createAnonymousUserComment,
    createLinearComment,
    prepareMarkdownContent,
    upsertUser,
    updateLinearComment
} from "../../pages/api/utils";
import {
    IssueCommentCreatedEvent,
    IssuesAssignedEvent,
    IssuesEvent,
    IssuesLabeledEvent,
    IssuesUnassignedEvent,
    IssuesUnlabeledEvent,
    MilestoneEvent,
    IssueCommentEditedEvent
} from "@octokit/webhooks-types";
import { generateLinearUUID } from "../linear";
import { GENERAL, LINEAR, SHARED } from "../constants";
import got from "got";
import { linearQuery } from "../apollo";
import { ApiError } from "../errors";

export async function githubWebhookHandler(
    body: IssuesEvent | IssueCommentCreatedEvent | MilestoneEvent,
    signature: string,
    githubEvent: string
) {
    const { repository, sender, action } = body;

    if (!!(body as IssuesEvent)?.issue?.pull_request) {
        return "Pull request event.";
    }

    let sync =
        !!repository?.id && !!sender?.id
            ? await prisma.sync.findFirst({
                  where: {
                      githubRepoId: repository.id,
                      githubUserId: sender.id
                  },
                  include: {
                      GitHubRepo: true,
                      LinearTeam: true
                  }
              })
            : null;

    if (
        (!sync?.LinearTeam || !sync?.GitHubRepo) &&
        !process.env.LINEAR_APPLICATION_ADMIN_KEY
    ) {
        throw new ApiError(
            `Team not found (repo: ${repository?.id || ""})`,
            404
        );
    }

    const { issue }: IssuesEvent = body as unknown as IssuesEvent;

    let anonymousUser = false;
    if (!sync) {
        anonymousUser = true;
        sync = !!repository?.id
            ? await prisma.sync.findFirst({
                  where: {
                      githubRepoId: repository.id
                  },
                  include: {
                      GitHubRepo: true,
                      LinearTeam: true
                  }
              })
            : null;

        if (!sync) {
            throw new ApiError(
                `Sync not found (repo: ${repository?.id || ""})`,
                404
            );
        }
    }

    const HMAC = createHmac("sha256", sync.GitHubRepo?.webhookSecret ?? "");
    const digest = Buffer.from(
        `sha256=${HMAC.update(JSON.stringify(body)).digest("hex")}`,
        "utf-8"
    );
    const sig = Buffer.from(signature, "utf-8");

    if (sig.length !== digest.length || !timingSafeEqual(digest, sig)) {
        throw new ApiError(
            `GH webhook secret doesn't match (repo: ${repository?.id || ""})`,
            403
        );
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

    let linearKey = process.env.LINEAR_API_KEY
        ? process.env.LINEAR_API_KEY
        : decrypt(linearApiKey, linearApiKeyIV);

    if (anonymousUser) {
        linearKey = process.env.LINEAR_APPLICATION_ADMIN_KEY;
    }

    const linear = new LinearClient({
        apiKey: linearKey
    });

    const githubKey = process.env.GITHUB_API_KEY
        ? process.env.GITHUB_API_KEY
        : decrypt(githubApiKey, githubApiKeyIV);

    const githubAuthHeader = `token ${githubKey}`;
    const userAgentHeader = `${repoName}, linear-github-sync`;
    const defaultHeaders = {
        headers: {
            "User-Agent": userAgentHeader,
            Authorization: githubAuthHeader
        }
    };

    const issuesEndpoint = `https://api.github.com/repos/${repoName}/issues`;

    if (!anonymousUser) {
        // Map the user's GitHub username to their Linear username if not yet mapped
        await upsertUser(
            linear,
            githubUserId,
            linearUserId,
            userAgentHeader,
            githubAuthHeader
        );
    }

    const syncedIssue = !!repository?.id
        ? await prisma.syncedIssue.findFirst({
              where: {
                  githubIssueNumber: issue?.number,
                  githubRepoId: repository.id
              }
          })
        : null;

    if (githubEvent === "issue_comment" && action === "edited") {
        if (!syncedIssue) return skipReason("comment", issue.number);

        const { comment } = body as IssueCommentEditedEvent;
        const regex = /LinearCommentId:(.*?):/;
        const match = comment.body.match(regex);
        const isLinearCommentIdPresent = match && match[1];

        if (isLinearCommentIdPresent) {
            const linearCommentId = match[1];
            const modifiedComment = await prepareMarkdownContent(
                comment.body,
                "github"
            );
            await updateLinearComment(
                linearCommentId,
                linear,
                syncedIssue.linearIssueId,
                modifiedComment,
                issue.number
            );
        }
    }

    if (githubEvent === "issue_comment" && action === "created") {
        // Comment created

        if (anonymousUser) {
            await createAnonymousUserComment(
                body as IssueCommentCreatedEvent,
                repository,
                sender
            );
        } else {
            const { comment } = body as IssueCommentCreatedEvent;

            if (comment.body.includes("on Linear")) {
                return skipReason("comment", issue.number, true);
            }

            if (!syncedIssue) return skipReason("comment", issue.number);

            const modifiedComment = await prepareMarkdownContent(
                comment.body,
                "github"
            );

            await createLinearComment(
                linear,
                syncedIssue,
                modifiedComment,
                issue
            );
        }
    }

    // Ensure the event is for an issue
    if (githubEvent !== "issues") return "Not an issue event.";

    if (action === "edited") {
        // Issue edited

        if (!syncedIssue) return skipReason("edit", issue.number);

        const title = issue.title.split(`${syncedIssue.linearIssueNumber}]`);
        if (title.length > 1) title.shift();

        const description = issue.body?.split("<sub>");

        if ((description?.length || 0) > 1) description?.pop();

        const modifiedDescription = await prepareMarkdownContent(
            description?.join("<sub>"),
            "github"
        );

        await linear
            .updateIssue(syncedIssue.linearIssueId, {
                title: title.join(`${syncedIssue.linearIssueNumber}]`),
                description: modifiedDescription
            })
            .then(updatedIssue => {
                updatedIssue.issue?.then(updatedIssueData => {
                    updatedIssueData.team?.then(teamData => {
                        if (!updatedIssue.success)
                            console.error(
                                `Issue edit failed: ${syncedIssue.linearIssueNumber} for #${issue.number} (repo: ${repository.id}).`
                            );
                        else
                            console.log(
                                `Edited issue ${teamData.key}-${syncedIssue.linearIssueNumber} for GitHub issue #${issue.number}.`
                            );
                    });
                });
            });
    } else if (["closed", "reopened"].includes(action)) {
        // Issue closed or reopened

        if (!syncedIssue) return skipReason("edit", issue.number);

        await linear
            .updateIssue(syncedIssue.linearIssueId, {
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
                            console.error(
                                `State change failed: ${syncedIssue.linearIssueNumber} for #${issue.number} (repo: ${repository.id}).`
                            );
                        else
                            console.log(
                                `Changed state ${teamData.key}-${syncedIssue.linearIssueNumber} for GitHub issue #${issue.number}.`
                            );
                    });
                });
            });
    } else if (
        action === "opened" ||
        (action === "labeled" &&
            body.label?.name?.toLowerCase() === LINEAR.GITHUB_LABEL)
    ) {
        // Issue opened or special "linear" label added

        if (syncedIssue) {
            return `Not creating: ${issue?.id || ""} exists as ${
                syncedIssue.linearIssueId
            } (repo: ${repository.id}).`;
        }

        if (issue.title.match(GENERAL.LINEAR_TICKET_ID_REGEX)) {
            return `Skipping creation as issue ${issue.number}'s title seems to contain a Linear ticket ID.`;
        }

        const modifiedDescription = await prepareMarkdownContent(
            issue.body,
            "github",
            {
                anonymous: anonymousUser,
                sender: sender
            }
        );

        // Collect other labels on the issue
        const githubLabels = issue.labels.filter(
            label => label.name !== "linear"
        );

        const linearLabels = await linear.issueLabels({
            includeArchived: true,
            filter: {
                team: { id: { eq: linearTeamId } },
                name: {
                    in: githubLabels.map(label =>
                        label.name.trim().toLowerCase()
                    )
                }
            }
        });

        const assignee = await prisma.user.findFirst({
            where: { githubUserId: issue.assignee?.id },
            select: { linearUserId: true }
        });

        const createdIssueData = await linear.createIssue({
            id: generateLinearUUID(),
            title: issue.title,
            description: `${modifiedDescription ?? ""}`,
            teamId: linearTeamId,
            labelIds: [
                ...linearLabels?.nodes?.map(node => node.id),
                publicLabelId
            ],
            ...(issue.assignee?.id &&
                assignee && {
                    assigneeId: assignee.linearUserId
                })
        });

        if (!createdIssueData.success) {
            const reason = `Failed to create ticket for #${issue.number} (repo: ${repository.id}).`;
            throw new ApiError(reason, 500);
        }

        const createdIssue = await createdIssueData.issue;

        if (!createdIssue) {
            console.log(
                `Failed to fetch created ticket for #${issue.number} (repo: ${repository.id}).`
            );
        } else {
            const team = await createdIssue.team;

            if (!team) {
                console.log(
                    `Failed to fetch team for ${createdIssue.id} for #${issue.number} (repo: ${repository.id}).`
                );
            } else {
                const ticketName = `${team.key}-${createdIssue.number}`;
                const attachmentQuery = getAttachmentQuery(
                    createdIssue.id,
                    issue.number,
                    repoName
                );

                const [
                    newSyncedIssue,
                    titleRenameResponse,
                    attachmentResponse
                ] = await Promise.all([
                    prisma.syncedIssue.create({
                        data: {
                            githubIssueNumber: issue.number,
                            githubIssueId: issue.id,
                            linearIssueId: createdIssue.id,
                            linearIssueNumber: createdIssue.number,
                            linearTeamId: team.id,
                            githubRepoId: repository.id
                        }
                    }),
                    got.patch(`${issuesEndpoint}/${issue.number}`, {
                        json: {
                            title: `[${ticketName}] ${issue.title}`,
                            body: `${issue.body}\n\n<sub>[${ticketName}](${createdIssue.url})</sub>`
                        },
                        ...defaultHeaders
                    }),
                    linearQuery(attachmentQuery, linearKey)
                ]);

                if (titleRenameResponse.statusCode > 201) {
                    console.log(
                        `Failed to update title for ${
                            createdIssue?.id || ""
                        } on ${issue.id} with status ${
                            titleRenameResponse.statusCode
                        } (repo: ${repository.id}).`
                    );
                }

                if (!attachmentResponse?.data?.attachmentCreate?.success) {
                    console.log(
                        `Failed to add attachment to ${
                            createdIssue?.id || ""
                        } for ${issue.id}: ${
                            attachmentResponse?.error || ""
                        } (repo: ${repository.id}).`
                    );
                }

                // Add issue comment history to newly-created Linear ticket
                if (action === "labeled") {
                    const issueCommentsPayload = await got.get(
                        `${issuesEndpoint}/${issue.number}/comments`,
                        { ...defaultHeaders }
                    );

                    if (issueCommentsPayload.statusCode > 201) {
                        throw new ApiError(
                            `Failed to fetch comments for ${issue.id} with status ${issueCommentsPayload.statusCode} (repo: ${repository.id}).`,
                            403
                        );
                    }

                    const comments = JSON.parse(issueCommentsPayload.body);

                    for await (const comment of comments) {
                        const modifiedComment = await prepareMarkdownContent(
                            comment.body,
                            "github"
                        );

                        await createLinearComment(
                            linear,
                            newSyncedIssue,
                            modifiedComment,
                            issue
                        );
                    }
                }
            }
        }
    } else if (["assigned", "unassigned"].includes(action)) {
        // Assignee changed

        if (!syncedIssue) return skipReason("assignee", issue.number);

        const { assignee: modifiedAssignee } = body as
            | IssuesAssignedEvent
            | IssuesUnassignedEvent;

        const ticket = await linear.issue(syncedIssue.linearIssueId);
        const linearAssignee = await ticket?.assignee;

        const remainingAssignee = issue?.assignee?.id
            ? await prisma.user.findFirst({
                  where: { githubUserId: issue?.assignee?.id },
                  select: { linearUserId: true }
              })
            : null;

        if (action === "unassigned") {
            // Remove assignee

            // Set remaining assignee only if different from current
            if (linearAssignee?.id != remainingAssignee?.linearUserId) {
                const response = await linear.updateIssue(
                    syncedIssue.linearIssueId,
                    { assigneeId: remainingAssignee?.linearUserId || null }
                );

                if (!response?.success) {
                    const reason = `Failed to unassign on ${syncedIssue.linearIssueId} for ${issue.id} (repo: ${repository.id}).`;
                    throw new ApiError(reason, 500);
                } else {
                    return `Removed assignee from Linear ticket for GitHub issue #${issue.number}.`;
                }
            }
        } else if (action === "assigned") {
            // Add assignee

            const newAssignee = modifiedAssignee?.id
                ? await prisma.user.findFirst({
                      where: { githubUserId: modifiedAssignee?.id },
                      select: { linearUserId: true }
                  })
                : null;

            if (!newAssignee) {
                return `Skipping assignee for ${issue.id}: Linear user not found for GH user ${modifiedAssignee?.login}`;
            }

            if (linearAssignee?.id != newAssignee?.linearUserId) {
                const response = await linear.updateIssue(
                    syncedIssue.linearIssueId,
                    { assigneeId: newAssignee.linearUserId }
                );

                if (!response?.success) {
                    const reason = `Failed to assign on ${syncedIssue.linearIssueId} for ${issue.id} (repo: ${repository.id}).`;
                    throw new ApiError(reason, 500);
                } else {
                    return `Assigned ${syncedIssue.linearIssueId} for ${issue.id} (repo: ${repository.id}).`;
                }
            }
        }
    } else if (["milestoned", "demilestoned"].includes(action)) {
        // Milestone added or removed from issue

        // Sync the newly-milestoned issue
        if (!syncedIssue) {
            if (action === "demilestoned") {
                return `Skipping milestone removal for ${issue.id}: not synced (repo: ${repository.id}).`;
            }

            const modifiedDescription = await prepareMarkdownContent(
                issue.body,
                "github",
                {
                    anonymous: anonymousUser,
                    sender: sender
                }
            );

            const assignee = await prisma.user.findFirst({
                where: { githubUserId: issue.assignee?.id },
                select: { linearUserId: true }
            });

            const createdIssueData = await linear.createIssue({
                id: generateLinearUUID(),
                title: issue.title,
                description: `${modifiedDescription ?? ""}`,
                teamId: linearTeamId,
                labelIds: [publicLabelId],
                ...(issue.assignee?.id &&
                    assignee && {
                        assigneeId: assignee.linearUserId
                    })
            });

            if (!createdIssueData.success) {
                throw new ApiError(
                    `Failed to create ticket for ${issue.id} (repo: ${repository.id}).`,
                    500
                );
            }

            const createdIssue = await createdIssueData.issue;

            if (!createdIssue) {
                console.log(
                    `Failed to fetch created ticket for ${issue.id} (repo: ${repository.id}).`
                );
            } else {
                const team = await createdIssue.team;

                if (!team) {
                    console.log(
                        `Failed to fetch team for ${createdIssue.id} for ${issue.id} (repo: ${repository.id}).`
                    );
                } else {
                    const ticketName = `${team.key}-${createdIssue.number}`;
                    const attachmentQuery = getAttachmentQuery(
                        createdIssue.id,
                        issue.number,
                        repoName
                    );

                    // Add to DB, update title, add attachment to issue, and fetch comments in parallel
                    const [
                        newSyncedIssue,
                        titleRenameResponse,
                        attachmentResponse,
                        issueCommentsPayload
                    ] = await Promise.all([
                        prisma.syncedIssue.create({
                            data: {
                                githubIssueNumber: issue.number,
                                githubIssueId: issue.id,
                                linearIssueId: createdIssue.id,
                                linearIssueNumber: createdIssue.number,
                                linearTeamId: team.id,
                                githubRepoId: repository.id
                            }
                        }),
                        got.patch(`${issuesEndpoint}/${issue.number}`, {
                            json: {
                                title: `[${ticketName}] ${issue.title}`,
                                body: `${issue.body}\n\n<sub>[${ticketName}](${createdIssue.url})</sub>`
                            },
                            ...defaultHeaders
                        }),
                        linearQuery(attachmentQuery, linearKey),
                        got.get(`${issuesEndpoint}/${issue.number}/comments`, {
                            ...defaultHeaders
                        })
                    ]);

                    if (titleRenameResponse.statusCode > 201) {
                        console.log(
                            `Failed to update title for ${
                                createdIssue?.id || ""
                            } on ${issue.id} with status ${
                                titleRenameResponse.statusCode
                            } (repo: ${repository.id}).`
                        );
                    }

                    if (!attachmentResponse?.data?.attachmentCreate?.success) {
                        console.log(
                            `Failed to add attachment to ${
                                createdIssue?.id || ""
                            } for ${issue.id}: ${
                                attachmentResponse?.error || ""
                            } (repo: ${repository.id})`
                        );
                    }

                    if (issueCommentsPayload.statusCode > 201) {
                        throw new ApiError(
                            `Failed to fetch comments for ${issue.id} with status ${issueCommentsPayload.statusCode} (repo: ${repository.id}).`,
                            403
                        );
                    }

                    // Add issue comment history to newly-created Linear ticket
                    const comments = JSON.parse(issueCommentsPayload.body);
                    for await (const comment of comments) {
                        const modifiedComment = await prepareMarkdownContent(
                            comment.body,
                            "github"
                        );

                        await createLinearComment(
                            linear,
                            newSyncedIssue,
                            modifiedComment,
                            issue
                        );
                    }
                }
            }
        }

        const { milestone } = issue;

        if (milestone === null) {
            return `Skipping over removal of milestone for issue #${issue.number}.`;
        }

        const isProject = milestone.description?.includes?.("(Project)");

        let syncedMilestone = await prisma.milestone.findFirst({
            where: {
                milestoneId: milestone.number,
                githubRepoId: repository.id
            }
        });

        if (!syncedMilestone) {
            if (milestone.description?.includes(getSyncFooter())) {
                return `Skipping over milestone "${milestone.title}" because it is caused by sync`;
            }

            const createdResource = await linear[
                isProject ? "createProject" : "createCycle"
            ]({
                name: milestone.title,
                description: `${milestone.description}\n\n> ${getSyncFooter()}`,
                ...(isProject && { teamIds: [linearTeamId] }),
                ...(!isProject && { teamId: linearTeamId }),
                ...(isProject && {
                    targetDate: milestone.due_on
                        ? new Date(milestone.due_on)
                        : null,
                    startDate: new Date()
                }),
                ...(!isProject && {
                    endsAt: milestone.due_on
                        ? new Date(milestone.due_on)
                        : null,
                    startsAt: new Date()
                })
            });

            if (!createdResource?.success) {
                const reason = `Failed to create Linear cycle/project for milestone ${milestone.id}.`;
                throw new ApiError(reason, 500);
            }

            const resourceData = await createdResource[
                isProject ? "project" : "cycle"
            ];

            syncedMilestone = await prisma.milestone.create({
                data: {
                    milestoneId: milestone.number,
                    githubRepoId: repository.id,
                    cycleId: resourceData.id,
                    linearTeamId: linearTeamId
                }
            });
        }

        const response = await linear.updateIssue(syncedIssue.linearIssueId, {
            ...(isProject
                ? { projectId: syncedMilestone.cycleId }
                : { cycleId: syncedMilestone.cycleId })
        });

        if (!response?.success) {
            const reason = `Failed to add Linear ticket to cycle/project for ${issue.id}.`;
            throw new ApiError(reason, 500);
        } else {
            return `Added Linear ticket to cycle/project for ${issue.id}.`;
        }
    } else if (["labeled", "unlabeled"].includes(action)) {
        // Label added to issue

        if (!syncedIssue) return skipReason("label", issue.id);

        const { label } = body as IssuesLabeledEvent | IssuesUnlabeledEvent;

        const linearLabels = label?.name
            ? await linear.issueLabels({
                  filter: {
                      name: {
                          containsIgnoreCase: label.name
                      }
                  }
              })
            : null;

        const priorityLabels = Object.values(SHARED.PRIORITY_LABELS);
        if (priorityLabels.map(l => l.name).includes(label?.name)) {
            await linear.updateIssue(syncedIssue.linearIssueId, {
                priority:
                    // Ignore removal of priority labels since it's triggered by priority change from Linear
                    action === "unlabeled"
                        ? null
                        : priorityLabels.find(l => l.name === label?.name)
                              ?.value
            });
        }

        if (!linearLabels?.nodes?.length) {
            // Could create the label in Linear here, but we'll skip it to avoid cluttering Linear.
            return `Skipping label "${label?.name}" for ${issue.id} as no Linear label was found (repo: ${repository.id}).`;
        }

        const linearLabelIDs = linearLabels.nodes.map(l => l.id);

        const ticket = await linear.issue(syncedIssue.linearIssueId);

        const currentTicketLabels = await ticket?.labels();
        const currentTicketLabelIDs = currentTicketLabels?.nodes?.map(
            n => n.id
        );

        const response = await linear.updateIssue(syncedIssue.linearIssueId, {
            labelIds: [
                ...(action === "labeled" ? linearLabelIDs : []),
                ...currentTicketLabelIDs.filter(
                    id => !linearLabelIDs.includes(id)
                )
            ]
        });

        if (!response?.success) {
            const reason = `Failed to add label "${label?.name}" to ${syncedIssue.linearIssueId} for ${issue.id} (repo: ${repository.id}).`;
            throw new ApiError(reason, 500);
        }

        return `Added label "${label?.name}" to Linear ticket for ${issue.id} (repo: ${repository.id}).`;
    }
}
