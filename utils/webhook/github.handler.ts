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
import { LINEAR, SHARED } from "../constants";
import got from "got";
import { linearQuery } from "../apollo";
import { ApiError } from "../errors";

export async function githubWebhookHandler(
    body: IssuesEvent | IssueCommentCreatedEvent | MilestoneEvent,
    signature: string,
    githubEvent: string
) {
    const { repository, sender, action } = body;

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
        console.log("Could not find issue's corresponding team.");
        throw new ApiError("Could not find issue's corresponding team.", 404);
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
            console.log(`Could not find sync for ${repository?.full_name}`);
            throw new ApiError(
                `Could not find sync for ${repository?.full_name}`,
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
        console.log("Failed to verify signature for webhook.");

        throw new ApiError("GitHub webhook secret doesn't match up.", 403);
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
        if (!syncedIssue) {
            const reason = skipReason("comment", issue.number);
            return reason;
        }
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
                console.log(skipReason("comment", issue.number, true));

                return skipReason("comment", issue.number, true);
            }

            if (!syncedIssue) {
                const reason = skipReason("comment", issue.number);
                return reason;
            }

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
    if (githubEvent !== "issues") {
        console.log("Not an issue event.");
        return "Not an issue event.";
    }

    if (action === "edited") {
        // Issue edited

        if (!syncedIssue) {
            const reason = skipReason("edit", issue.number);
            return reason;
        }

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
            return reason;
        }

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
            body.label?.name?.toLowerCase() === LINEAR.GITHUB_LABEL)
    ) {
        // Issue opened or special "linear" label added

        if (syncedIssue) {
            const reason = `Not creating ticket as issue ${issue.number} already exists on Linear as ${syncedIssue.linearIssueNumber}.`;
            return reason;
        }

        const modifiedDescription = await prepareMarkdownContent(
            issue.body,
            "github",
            {
                anonymous: anonymousUser,
                sender: sender
            }
        );

        /** In case if user has added some other labels on issue */
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
            const reason = `Failed to create ticket for GitHub issue #${issue.number}.`;
            throw new ApiError(reason, 500);
        }

        const createdIssue = await createdIssueData.issue;

        if (!createdIssue) {
            console.log(
                `Failed to fetch ticket I just created for GitHub issue #${issue.number}.`
            );
        } else {
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
                        `Failed to update title for ${ticketName} on GitHub issue #${issue.number} with status ${titleRenameResponse.statusCode}.`
                    );
                }

                if (!attachmentResponse?.data?.attachmentCreate?.success) {
                    console.log(
                        `Failed to add attachment to ${ticketName} for GitHub issue #${
                            issue.number
                        }: ${attachmentResponse?.error || ""}.`
                    );
                }

                // Add issue comment history to newly-created Linear ticket
                if (action === "labeled") {
                    const issueCommentsPayload = await got.get(
                        `${issuesEndpoint}/${issue.number}/comments`,
                        { ...defaultHeaders }
                    );

                    if (issueCommentsPayload.statusCode > 201) {
                        console.log(
                            `Failed to fetch comments for GitHub issue #${issue.number} with status ${issueCommentsPayload.statusCode}.`
                        );
                        throw new ApiError(
                            `Could not fetch comments for GitHub issue #${issue.number}`,
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

        if (!syncedIssue) {
            const reason = skipReason("assignee", issue.number);
            return reason;
        }

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
                    const reason = `Failed to remove assignee on Linear ticket for GitHub issue #${issue.number}.`;
                    throw new ApiError(reason, 500);
                } else {
                    const reason = `Removed assignee from Linear ticket for GitHub issue #${issue.number}.`;
                    return reason;
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
                const reason = `Skipping assignee for issue #${issue.number} as no Linear user was found for GitHub user ${modifiedAssignee?.login}.`;
                return reason;
            }

            if (linearAssignee?.id != newAssignee?.linearUserId) {
                const response = await linear.updateIssue(
                    syncedIssue.linearIssueId,
                    { assigneeId: newAssignee.linearUserId }
                );

                if (!response?.success) {
                    const reason = `Failed to add assignee on Linear ticket for GitHub issue #${issue.number}.`;
                    throw new ApiError(reason, 500);
                } else {
                    const reason = `Added assignee to Linear ticket for GitHub issue #${issue.number}.`;
                    return reason;
                }
            }
        }
    } else if (["milestoned", "demilestoned"].includes(action)) {
        // Milestone added or removed from issue

        // Sync the newly-milestoned issue
        if (!syncedIssue) {
            if (action === "demilestoned") {
                return `Skipping over removal of milestone for issue #${issue.number} because it is not synced`;
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
                const reason = `Failed to create ticket for GitHub issue #${issue.number}.`;
                throw new ApiError(reason, 500);
            }

            const createdIssue = await createdIssueData.issue;

            if (!createdIssue) {
                console.log(
                    `Failed to fetch ticket I just created for GitHub issue #${issue.number}.`
                );
            } else {
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
                            `Failed to update title for ${ticketName} on GitHub issue #${issue.number} with status ${titleRenameResponse.statusCode}.`
                        );
                    }

                    if (!attachmentResponse?.data?.attachmentCreate?.success) {
                        console.log(
                            `Failed to add attachment to ${ticketName} for GitHub issue #${
                                issue.number
                            }: ${attachmentResponse?.error || ""}.`
                        );
                    }

                    if (issueCommentsPayload.statusCode > 201) {
                        console.log(
                            `Failed to fetch comments for GitHub issue #${issue.number} with status ${issueCommentsPayload.statusCode}.`
                        );
                        throw new ApiError(
                            `Could not fetch comments for GitHub issue #${issue.number}`,
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
                const reason = `Skipping over milestone "${milestone.title}" because it is caused by sync`;
                return reason;
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
                const reason = `Failed to create Linear cycle/project for GitHub milestone #${milestone.number}.`;
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
            const reason = `Failed to add Linear ticket to cycle/project for GitHub issue #${issue.number}.`;
            throw new ApiError(reason, 500);
        } else {
            const reason = `Added Linear ticket to cycle/project for GitHub issue #${issue.number}.`;
            return reason;
        }
    } else if (["labeled", "unlabeled"].includes(action)) {
        // Label added to issue

        if (!syncedIssue) {
            return skipReason("label", issue.number);
        }

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
            return `Skipping label "${label?.name}" for issue #${issue.number} as no Linear label was found.`;
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
            const reason = `Failed to add label "${label?.name}" to Linear ticket for GitHub issue #${issue.number}.`;
            throw new ApiError(reason, 500);
        }

        return `Added label "${label?.name}" to Linear ticket for GitHub issue #${issue.number}.`;
    }
}
