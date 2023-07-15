import prisma from "../../prisma";
import { createHmac, timingSafeEqual } from "crypto";
import {
    decrypt,
    formatJSON,
    getAttachmentQuery,
    getSyncFooter,
    skipReason
} from "../index";
import { LinearClient } from "@linear/sdk";
import {
    prepareMarkdownContent,
    replaceMentions,
    upsertUser
} from "../../pages/api/utils";
import {
    Issue,
    IssueCommentCreatedEvent,
    IssuesAssignedEvent,
    IssuesEvent,
    IssuesUnassignedEvent,
    MilestoneEvent,
    Repository,
    User
} from "@octokit/webhooks-types";
import {
    createLinearCycle,
    generateLinearUUID,
    updateLinearCycle
} from "../linear";
import { LINEAR } from "../constants";
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
                console.log(reason);
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

    if (githubEvent === "milestone") {
        const { milestone } = body as MilestoneEvent;
        if (!milestone) throw new ApiError("No milestone found", 404);

        const syncedMilestone = await prisma.milestone.findFirst({
            where: {
                milestoneId: milestone.id,
                githubRepoId: repository.id
            }
        });

        if (action === "edited") {
            if (!syncedMilestone?.cycleId) {
                const reason = `Skipping over update for milestone "${milestone.title}" because it is not synced`;
                console.log(reason);
                return reason;
            }

            if (milestone.description?.includes(getSyncFooter())) {
                const reason = `Skipping over update for milestone "${milestone.title}" because it is caused by sync`;
                console.log(reason);
                return reason;
            }

            const cycleResponse = await updateLinearCycle(
                linearKey,
                syncedMilestone.cycleId,
                milestone.title,
                `${milestone.description}\n\n> ${getSyncFooter()}`,
                milestone.due_on ? new Date(milestone.due_on) : null
            );

            if (!cycleResponse?.data?.cycleUpdate?.success) {
                const error = `Could not update cycle "${milestone.title}" for ${repoName}`;
                console.log(error);
                throw new ApiError(error, 500);
            } else {
                const result = `Updated cycle "${milestone.title}" for ${repoName}`;
                console.log(result);
                return result;
            }
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
            console.log(reason);
            return reason;
        }

        const title = issue.title.split(`${syncedIssue.linearIssueNumber}]`);
        if (title.length > 1) title.shift();

        const description = issue.body?.split("<sub>");

        if ((description?.length || 0) > 1) description?.pop();

        let modifiedDescription = await replaceMentions(
            description?.join("<sub>"),
            "github"
        );

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
            return reason;
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
            body.label?.name?.toLowerCase() === LINEAR.GITHUB_LABEL)
    ) {
        // Issue opened or special "linear" label added

        if (syncedIssue) {
            const reason = `Not creating ticket as issue ${issue.number} already exists on Linear as ${syncedIssue.linearIssueNumber}.`;
            console.log(reason);
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
            ...(issue.assignee?.id &&
                assignee && {
                    assigneeId: assignee.linearUserId
                })
        });

        if (!createdIssueData.success) {
            const reason = `Failed to create ticket for GitHub issue #${issue.number}.`;
            console.log(reason);
            throw new ApiError(reason, 500);
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
                    got
                        .patch(`${issuesEndpoint}/${issue.number}`, {
                            json: {
                                title: `[${ticketName}] ${issue.title}`,
                                body: `${issue.body}\n\n<sub>[${ticketName}](${createdIssue.url})</sub>`
                            },
                            headers: {
                                "User-Agent": userAgentHeader,
                                Authorization: githubAuthHeader
                            }
                        })
                        .then(titleRenameResponse => {
                            if (titleRenameResponse.statusCode > 201)
                                console.log(
                                    `Failed to update GitHub issue title for ${ticketName} on GitHub issue #${
                                        issue.number
                                    }, received status code ${
                                        titleRenameResponse.statusCode
                                    }, body of ${formatJSON(
                                        JSON.parse(titleRenameResponse.body)
                                    )}.`
                                );
                            else
                                console.log(
                                    `Created comment on GitHub issue #${issue.number} for Linear issue ${ticketName}.`
                                );
                        }),
                    linearQuery(attachmentQuery, linearKey).then(response => {
                        if (!response?.data?.attachmentCreate?.success) {
                            console.log(
                                `Failed to create attachment on ${ticketName} for GitHub issue #${
                                    issue.number
                                }, received response ${
                                    response?.error ?? response?.data ?? ""
                                }.`
                            );
                        } else {
                            console.log(
                                `Created attachment on ${ticketName} for GitHub issue #${issue.number}.`
                            );
                        }
                    }),
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
            const issueCommentsPayload = await got.get(
                `${issuesEndpoint}/${issue.number}/comments`,
                {
                    headers: {
                        "User-Agent": userAgentHeader,
                        Authorization: githubAuthHeader
                    }
                }
            );

            if (issueCommentsPayload.statusCode > 201) {
                console.log(
                    `Failed to fetch comments for GitHub issue #${
                        issue.number
                    } [${issue.id}], received status code ${
                        issueCommentsPayload.statusCode
                    }, body of ${formatJSON(
                        JSON.parse(issueCommentsPayload.body)
                    )}.`
                );

                throw new ApiError(
                    `Could not fetch comments for GitHub issue #${issue.number} [${issue.id}]`,
                    403
                );
            }

            const comments = JSON.parse(issueCommentsPayload.body);

            for (const comment of comments) {
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
    } else if (["assigned", "unassigned"].includes(action)) {
        // Assignee changed

        if (!syncedIssue) {
            const reason = skipReason("assignee", issue.number);
            console.log(reason);
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
                const response = await linear.issueUpdate(
                    syncedIssue.linearIssueId,
                    { assigneeId: remainingAssignee?.linearUserId || null }
                );

                if (!response?.success) {
                    const reason = `Failed to remove assignee on Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    throw new ApiError(reason, 500);
                } else {
                    const reason = `Removed assignee from Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
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
                console.log(reason);
                return reason;
            }

            if (linearAssignee?.id != newAssignee?.linearUserId) {
                const response = await linear.issueUpdate(
                    syncedIssue.linearIssueId,
                    { assigneeId: newAssignee.linearUserId }
                );

                if (!response?.success) {
                    const reason = `Failed to add assignee on Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    throw new ApiError(reason, 500);
                } else {
                    const reason = `Added assignee to Linear ticket for GitHub issue #${issue.number}.`;
                    console.log(reason);
                    return reason;
                }
            }
        }
    } else if (["milestoned", "demilestoned"].includes(action)) {
        // Milestone added or removed from issue

        if (!syncedIssue) {
            const reason = skipReason("milestone", issue.number);
            console.log(reason);
            return reason;
        }

        const { milestone } = issue;
        if (milestone === null) {
            const response = await linear.issueUpdate(
                syncedIssue.linearIssueId,
                {
                    cycleId: null
                }
            );

            if (!response?.success) {
                const reason = `Failed to remove Linear ticket from cycle for GitHub issue #${issue.number}.`;
                console.log(reason);
                throw new ApiError(reason, 500);
            } else {
                const reason = `Removed Linear ticket from cycle for GitHub issue #${issue.number}.`;
                console.log(reason);
                return reason;
            }
        }

        let syncedMilestone = await prisma.milestone.findFirst({
            where: {
                milestoneId: milestone.number,
                githubRepoId: repository.id
            }
        });

        if (!syncedMilestone) {
            if (milestone.description?.includes(getSyncFooter())) {
                const reason = `Skipping over milestone "${milestone.title}" because it is caused by sync`;
                console.log(reason);
                return reason;
            }

            const createdCycle = await createLinearCycle(
                linearKey,
                linearTeamId,
                milestone.title,
                `${milestone.description}\n\n> ${getSyncFooter()}`,
                milestone.due_on ? new Date(milestone.due_on) : null
            );

            if (!createdCycle?.data?.cycleCreate?.cycle?.id) {
                const reason = `Failed to create Linear cycle for GitHub milestone #${milestone.number}.`;
                console.log(reason);
                throw new ApiError(reason, 500);
            }

            syncedMilestone = await prisma.milestone.create({
                data: {
                    milestoneId: milestone.number,
                    githubRepoId: repository.id,
                    cycleId: createdCycle.data.cycleCreate.cycle.id,
                    linearTeamId: linearTeamId
                }
            });
        }

        const response = await linear.issueUpdate(syncedIssue.linearIssueId, {
            cycleId: syncedMilestone.cycleId
        });

        if (!response?.success) {
            const reason = `Failed to add Linear ticket to cycle for GitHub issue #${issue.number}.`;
            console.log(reason);
            throw new ApiError(reason, 500);
        } else {
            const reason = `Added Linear ticket to cycle for GitHub issue #${issue.number}.`;
            console.log(reason);
            return reason;
        }
    }
}

async function createLinearComment(
    linear: LinearClient,
    syncedIssue,
    modifiedComment: string,
    issue: Issue
) {
    const comment = await linear.commentCreate({
        id: generateLinearUUID(),
        issueId: syncedIssue.linearIssueId,
        body: modifiedComment ?? ""
    });
    const commentData = await comment.comment;
    const issueData = await commentData.issue;
    const teamData = await issueData.team;

    if (!comment.success) {
        throw new ApiError(
            `Failed to create comment on Linear issue ${syncedIssue.linearIssueId} for GitHub issue ${issue.number}`,
            500
        );
    } else {
        console.log(
            `Created comment for ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${issue.number} [${issue.id}].`
        );
    }
}

async function createAnonymousUserComment(
    body: IssueCommentCreatedEvent,
    repository: Repository,
    sender: User
) {
    const { issue }: IssuesEvent = body as unknown as IssuesEvent;

    const syncedIssue = !!repository?.id
        ? await prisma.syncedIssue.findFirst({
              where: {
                  githubIssueNumber: issue?.number,
                  githubRepoId: repository.id
              }
          })
        : null;

    if (!syncedIssue) {
        console.log("Could not find issue's corresponding team.");
        throw new ApiError("Could not find issue's corresponding team.", 404);
    }

    const linearKey = process.env.LINEAR_APPLICATION_ADMIN_KEY;
    const linear = new LinearClient({
        apiKey: linearKey
    });

    const { comment: githubComment }: IssueCommentCreatedEvent = body;
    const modifiedComment = await prepareMarkdownContent(
        githubComment.body,
        "github",
        {
            anonymous: true,
            sender: sender
        }
    );

    await createLinearComment(linear, syncedIssue, modifiedComment, issue);
}
