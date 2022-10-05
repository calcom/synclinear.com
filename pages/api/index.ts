import petitio from "petitio";
import { components } from "@octokit/openapi-types";
import { LinearWebhookPayload } from "../../typings";
import { createHmac, timingSafeEqual } from "crypto";
import {
    IssueCommentCreatedEvent,
    IssuesEditedEvent,
    IssuesClosedEvent,
    IssuesOpenedEvent
} from "@octokit/webhooks-types";
import { LinearClient } from "@linear/sdk";
import prisma from "../../prisma";
import { NextApiRequest, NextApiResponse } from "next";
import {
    decrypt,
    formatJSON,
    getAttachmentQuery,
    getGitHubFooter,
    getLinearFooter,
    getSyncFooter,
    inviteMember,
    isIssue,
    skipReason
} from "../../utils";
import { GITHUB, LINEAR } from "../../utils/constants";
import { getIssueUpdateError, getOtherUpdateError } from "../../utils/errors";

export default async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
        return res.status(405).send({
            success: false,
            message: "Only POST requests are accepted."
        });
    else if (
        LINEAR.IP_ORIGINS.includes(req.socket.remoteAddress || "") &&
        !req.headers["x-hub-signature-256"]
    )
        return res.status(403).send({
            success: false,
            message: "Request not from Linear or GitHub."
        });

    if (req.headers["user-agent"] === "Linear-Webhook") {
        const {
            action,
            updatedFrom,
            data,
            type: actionType
        }: LinearWebhookPayload = req.body;

        const syncs = await prisma.sync.findMany({
            where: {
                linearUserId: data.user.id
            },
            include: {
                LinearTeam: true,
                GitHubRepo: true
            }
        });

        if (
            syncs.length === 0 ||
            !syncs.find(sync => sync.linearUserId === data.user.id)
        ) {
            return res.status(200).send({
                success: true,
                message: "Could not find Linear user in syncs."
            });
        }

        const sync = syncs.find(sync => sync.linearUserId === data.user.id);

        if (!sync?.LinearTeam || !sync?.GitHubRepo) {
            return res.status(404).send({
                success: false,
                message: "Could not find synced repo or team."
            });
        }

        const {
            linearUserId,
            linearApiKey,
            linearApiKeyIV,
            githubApiKey,
            githubApiKeyIV,
            LinearTeam: { publicLabelId, doneStateId, canceledStateId },
            GitHubRepo: { repoName: repoFullName, repoId }
        } = sync;

        const linearKeyDecrypted = decrypt(linearApiKey, linearApiKeyIV);
        const linear = new LinearClient({
            apiKey: linearKeyDecrypted
        });

        const githubAuthHeader = `token ${decrypt(
            githubApiKey,
            githubApiKeyIV
        )}`;

        const userAgentHeader = `${repoFullName}, linear-github-sync`;
        const issuesEndpoint = `https://api.github.com/repos/${repoFullName}/issues`;

        // Label updated on an already-public issue
        if (
            action === "update" &&
            updatedFrom &&
            data.labelIds.includes(publicLabelId)
        ) {
            if (updatedFrom.labelIds?.includes(publicLabelId)) {
                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: data.id,
                        linearTeamId: data.teamId
                    },
                    include: { GitHubRepo: true }
                });

                if (!syncedIssue) {
                    console.log(
                        skipReason("label", `${data.team.key}-${data.number}`)
                    );
                    return res.status(200).send({
                        success: true,
                        message: skipReason(
                            "label",
                            `${data.team.key}-${data.number}`
                        )
                    });
                }

                if (data.labelIds.length < updatedFrom.labelIds.length) {
                    const removedLabelId = updatedFrom.labelIds.find(
                        id => !data.labelIds.includes(id)
                    );

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
                        console.log(`Could not remove "${label.name}".`);
                        return res.status(403).send({
                            success: false,
                            message: `Could not remove "${label.name}".`
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
                        createdLabelData.errors[0]?.code !== "already_exists"
                    ) {
                        console.log("Could not create label.");
                        return res.status(403).send({
                            success: false,
                            message: "Could not create label."
                        });
                    }

                    const appliedLabelResponse = await petitio(
                        `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/labels`,
                        "POST"
                    )
                        .header("User-Agent", userAgentHeader)
                        .header("Authorization", githubAuthHeader)
                        .body({
                            labels: [createdLabelData.name]
                        })
                        .send();

                    if (appliedLabelResponse.statusCode > 201) {
                        console.log("Could not apply label.");
                        return res.status(403).send({
                            success: false,
                            message: "Could not apply label."
                        });
                    } else {
                        console.log(
                            `Applied label "${createdLabelData.name}" to issue #${syncedIssue.githubIssueNumber}.`
                        );
                    }
                }
            }

            // Public label added to an issue
            if (
                updatedFrom.labelIds &&
                !updatedFrom.labelIds.includes(publicLabelId)
            ) {
                const issueAlreadyExists = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: data.id,
                        linearTeamId: data.teamId
                    }
                });

                if (issueAlreadyExists) {
                    console.log(
                        `Not creating issue after label added as issue ${data.team.key}-${data.number} [${data.id}] already exists on GitHub as issue #${issueAlreadyExists.githubIssueNumber} [${issueAlreadyExists.githubIssueId}].`
                    );

                    return res.status(200).send({
                        success: true,
                        message: "Issue already exists on GitHub."
                    });
                }

                const issueCreator = await linear.user(data.creatorId);

                const createdIssueResponse = await petitio(
                    issuesEndpoint,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        title: `[${data.team.key}-${data.number}] ${data.title}`,
                        body: `${data.description}${getGitHubFooter(
                            issueCreator.name
                        )}`
                    })
                    .send();

                if (!syncs.some(sync => sync.linearUserId === data.creatorId)) {
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

                await Promise.all([
                    petitio(LINEAR.GRAPHQL_ENDPOINT, "POST")
                        .header("Authorization", `Bearer ${linearKeyDecrypted}`)
                        .header("Content-Type", "application/json")
                        .body({
                            query: getAttachmentQuery(
                                data.id,
                                createdIssueData.number,
                                repoFullName
                            )
                        })
                        .send()
                        .then(attachmentResponse => {
                            const attachmentData: {
                                success: boolean;
                                attachment: {
                                    id: string;
                                };
                            } = attachmentResponse.json();
                            if (attachmentResponse.statusCode > 201)
                                console.log(
                                    getOtherUpdateError(
                                        "attachment",
                                        data,
                                        createdIssueData,
                                        createdIssueResponse,
                                        attachmentData
                                    )
                                );
                            else if (!attachmentData.success)
                                console.log(
                                    `Failed to create attachment for ${data.team.key}-${data.number} [${data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
                            else
                                console.log(
                                    `Created attachment for ${data.team.key}-${data.number} [${data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
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

                for (const linearComment of linearComments) {
                    if (!linearComment) continue;

                    const { comment, user } = linearComment;

                    await petitio(
                        `${issuesEndpoint}/${createdIssueData.number}/comments`,
                        "POST"
                    )
                        .header("User-Agent", userAgentHeader)
                        .header("Authorization", githubAuthHeader)
                        .body({
                            body: `${comment.body}${getGitHubFooter(user.name)}`
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
                                    `Created comment on GitHub issue #${createdIssueData.number} [${createdIssueData.id}] for Linear issue ${data.team.key}-${data.number}.`
                                );
                        });
                }
            }

            if (updatedFrom.title) {
                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearTeamId: data.teamId,
                        linearIssueId: data.id
                    },
                    include: { GitHubRepo: true }
                });

                if (!syncedIssue) {
                    console.log(
                        skipReason("edit", `${data.team.key}-${data.number}`)
                    );

                    return res.status(200).send({
                        success: true,
                        message: skipReason(
                            "edit",
                            `${data.team.key}-${data.number}`
                        )
                    });
                }

                await petitio(
                    `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                    "PATCH"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        title: `[${data.team.key}-${data.number}] ${data.title}`
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
                                `Updated GitHub issue title for ${data.team.key}-${data.number} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            }

            if (updatedFrom.description) {
                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: data.id,
                        linearTeamId: data.teamId
                    },
                    include: { GitHubRepo: true }
                });

                if (!syncedIssue) {
                    console.log(
                        skipReason("edit", `${data.team.key}-${data.number}`)
                    );

                    return res.status(200).send({
                        success: true,
                        message: skipReason(
                            "edit",
                            `${data.team.key}-${data.number}`
                        )
                    });
                }

                const issueCreator = await linear.user(data.creatorId);

                await petitio(
                    `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}`,
                    "PATCH"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        body: `${data.description}${getGitHubFooter(
                            issueCreator.name
                        )}`
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
                                `Updated GitHub issue description for ${data.team.key}-${data.number} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            }

            if (updatedFrom.stateId) {
                if (data.user?.id === linearUserId) {
                    console.log(
                        skipReason(
                            "state change",
                            `${data.team.key}-${data.number}`,
                            true
                        )
                    );

                    return res.status(200).send({
                        success: true,
                        message: skipReason(
                            "state change",
                            `${data.team.key}-${data.number}`,
                            true
                        )
                    });
                }

                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: data.id,
                        linearTeamId: data.teamId
                    },
                    include: { GitHubRepo: true }
                });

                if (!syncedIssue) {
                    console.log(
                        skipReason(
                            "state change",
                            `${data.team.key}-${data.number}`
                        )
                    );

                    return res.status(200).send({
                        success: true,
                        message: skipReason(
                            "state change",
                            `${data.team.key}-${data.number}`
                        )
                    });
                }

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
                                `Updated GitHub issue state for ${data.team.key}-${data.number} [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            }
        }

        if (action === "create") {
            if (actionType === "Comment") {
                if (
                    data.user?.id === linearUserId &&
                    data.body.includes("on GitHub")
                ) {
                    console.log(skipReason("comment", data.issue!.id, true));

                    return res.status(200).send({
                        success: true,
                        message: skipReason("comment", data.issue!.id, true)
                    });
                }

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

                await petitio(
                    `${GITHUB.REPO_ENDPOINT}/${syncedIssue.GitHubRepo.repoName}/issues/${syncedIssue.githubIssueNumber}/comments`,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        body: `${data.body}${getGitHubFooter(data.user!.name)}`
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
            } else if (
                actionType === "Issue" &&
                data.labelIds.includes(publicLabelId)
            ) {
                if (data.description?.includes(getSyncFooter())) {
                    console.log(skipReason("issue", data.id, true));

                    return res.status(200).send({
                        success: true,
                        message: skipReason("issue", data.id, true)
                    });
                }

                const issueAlreadyExists = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: data.id,
                        linearTeamId: data.teamId
                    }
                });

                if (issueAlreadyExists) {
                    console.log(
                        `Not creating issue after label added as issue ${data.team.key}-${data.number} [${data.id}] already exists on GitHub as issue #${issueAlreadyExists.githubIssueNumber} [${issueAlreadyExists.githubIssueId}].`
                    );

                    return res.status(200).send({
                        success: true,
                        message: "Issue already exists on GitHub."
                    });
                }

                const createdIssueResponse = await petitio(
                    issuesEndpoint,
                    "POST"
                )
                    .header("User-Agent", userAgentHeader)
                    .header("Authorization", githubAuthHeader)
                    .body({
                        title: `[${data.team.key}-${data.number}] ${data.title}`,
                        body: `${data.description}${getSyncFooter()}`
                    })
                    .send();

                if (!syncs.some(sync => sync.linearUserId === data.creatorId)) {
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
                        }, body of ${formatJSON(createdIssueResponse.json())}.`
                    );

                    return res.status(500).send({
                        success: false,
                        message: `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`
                    });
                }

                let createdIssueData: components["schemas"]["issue"] =
                    await createdIssueResponse.json();

                await Promise.all([
                    petitio(LINEAR.GRAPHQL_ENDPOINT, "POST")
                        .header("Authorization", `Bearer ${linearKeyDecrypted}`)
                        .header("Content-Type", "application/json")
                        .body({
                            query: getAttachmentQuery(
                                data.id,
                                createdIssueData.number,
                                repoFullName
                            )
                        })
                        .send()
                        .then(attachmentResponse => {
                            const attachmentData: {
                                success: boolean;
                                attachment: {
                                    id: string;
                                };
                            } = attachmentResponse.json();
                            if (attachmentResponse.statusCode > 201)
                                console.log(
                                    getOtherUpdateError(
                                        "attachment",
                                        data,
                                        createdIssueData,
                                        createdIssueResponse,
                                        attachmentData
                                    )
                                );
                            else if (!attachmentData.success)
                                console.log(
                                    `Failed to create attachment for ${data.team.key}-${data.number} [${data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
                            else
                                console.log(
                                    `Created attachment for ${data.team.key}-${data.number} [${data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
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
                ]);
            }
        }
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
            return res.status(404).send({
                success: false,
                message: "Could not find synced repo or team."
            });
        }

        const {
            linearApiKey,
            linearApiKeyIV,
            githubApiKey,
            githubApiKeyIV,
            LinearTeam: {
                publicLabelId,
                doneStateId,
                toDoStateId,
                canceledStateId,
                teamId: linearTeamId
            },
            GitHubRepo: { repoName: repoFullName, webhookSecret }
        } = sync;

        const HMAC = createHmac("sha256", webhookSecret ?? "");
        const digest = Buffer.from(
            `sha256=${HMAC.update(JSON.stringify(req.body)).digest("hex")}`,
            "utf-8"
        );
        const sig = Buffer.from(
            req.headers["x-hub-signature-256"] as string,
            "utf-8"
        );

        if (sig.length !== digest.length || !timingSafeEqual(digest, sig)) {
            console.log(`Failed to verify signature for webhook.`);

            return res.status(403).send({
                success: false,
                message: "GitHub webhook secret doesn't match up."
            });
        }

        const linearKeyDecrypted = decrypt(linearApiKey, linearApiKeyIV);
        const linear = new LinearClient({
            apiKey: linearKeyDecrypted
        });

        const githubAuthHeader = `token ${decrypt(
            githubApiKey,
            githubApiKeyIV
        )}`;

        const userAgentHeader = `${repoFullName}, linear-github-sync`;
        const issuesEndpoint = `https://api.github.com/repos/${repoFullName}/issues`;

        if (
            req.headers["x-github-event"] === "issue_comment" &&
            action === "created"
        ) {
            const { issue, comment }: IssueCommentCreatedEvent = req.body;

            if (comment.body.includes("on Linear")) {
                console.log(skipReason("comment", issue.number, true));

                return res.status(200).send({
                    success: true,
                    message: skipReason("comment", issue.number, true)
                });
            }

            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    githubIssueNumber: issue.number
                }
            });

            if (!syncedIssue) {
                console.log(skipReason("comment", issue.number));

                return res.status(200).send({
                    success: true,
                    message: skipReason("comment", issue.number)
                });
            }

            await linear
                .commentCreate({
                    issueId: syncedIssue.linearIssueId,
                    body: `${comment.body}${getLinearFooter(sender)}`
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
        } else if (isIssue(req) && action === "edited") {
            const { issue }: IssuesEditedEvent = req.body;

            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    githubIssueNumber: issue.number
                }
            });

            if (!syncedIssue) {
                console.log(skipReason("edit", issue.number));

                return res.status(200).send({
                    success: true,
                    message: skipReason("edit", issue.number)
                });
            }

            const title = issue.title.split(
                `${syncedIssue.linearIssueNumber}]`
            );
            if (title.length > 1) title.shift();

            const description = issue.body?.split("<sub>");
            if ((description?.length || 0) > 1) description?.pop();

            await linear
                .issueUpdate(syncedIssue.linearIssueId, {
                    title: title.join(`${syncedIssue.linearIssueNumber}]`),
                    description: description?.join("<sub>")
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
        } else if (isIssue(req) && ["closed", "reopened"].includes(action)) {
            const { issue }: IssuesClosedEvent = req.body;

            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    githubIssueNumber: issue.number
                }
            });

            if (!syncedIssue) {
                console.log(skipReason("edit", issue.number));

                return res.status(200).send({
                    success: true,
                    message: skipReason("edit", issue.number)
                });
            }

            const title = issue.title.split(
                `${syncedIssue.linearIssueNumber}]`
            );
            if (title.length > 1) title.shift();

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
        } else if (isIssue(req) && action === "opened") {
            const {
                issue
            }: IssuesOpenedEvent & {
                issue: {
                    closed_at: never;
                };
            } = req.body;

            if (issue.body?.includes(getSyncFooter())) {
                console.log(skipReason("edit", issue.number, true));

                return res.status(200).send({
                    success: true,
                    message: skipReason("edit", issue.number, true)
                });
            }

            const createdIssueData = await linear.issueCreate({
                title: issue.title,
                description: `${issue.body}${getSyncFooter()}`,
                teamId: linearTeamId,
                labelIds: [publicLabelId]
            });

            if (!createdIssueData.success) {
                console.log(
                    `Failed to create issue for GitHub issue #${issue.number} [${issue.id}].`
                );

                return res.status(500).send({
                    success: false,
                    message: `Failed creating issue on Linear.`
                });
            }

            const createdIssue = await createdIssueData.issue;

            if (!createdIssue)
                console.log(
                    `Failed to fetch issue I just created for GitHub issue #${issue.number} [${issue.id}].`
                );
            else {
                const team = await createdIssue.team;

                if (!team) {
                    console.log(
                        `Failed to fetch team for issue, ${createdIssue.id} for GitHub issue #${issue.number} [${issue.id}].`
                    );
                } else {
                    await Promise.all([
                        petitio(`${issuesEndpoint}/${issue.number}`, "PATCH")
                            .header("User-Agent", userAgentHeader)
                            .header("Authorization", githubAuthHeader)
                            .body({
                                title: `[${team.key}-${createdIssue.number}] ${issue.title}`
                            })
                            .send()
                            .then(titleRenameResponse => {
                                if (titleRenameResponse.statusCode > 201)
                                    console.log(
                                        `Failed to update GitHub issue title for ${
                                            team.key
                                        }-${createdIssue.number} [${
                                            createdIssue.id
                                        }] on GitHub issue #${issue.number} [${
                                            issue.id
                                        }], received status code ${
                                            titleRenameResponse.statusCode
                                        }, body of ${formatJSON(
                                            titleRenameResponse.json()
                                        )}.`
                                    );
                                else
                                    console.log(
                                        `Created comment on GitHub issue #${issue.number} [${issue.id}] for Linear issue ${team.key}-${createdIssue.number}.`
                                    );
                            }),
                        petitio(LINEAR.GRAPHQL_ENDPOINT, "POST")
                            .header(
                                "Authorization",
                                `Bearer ${linearKeyDecrypted}`
                            )
                            .header("Content-Type", "application/json")
                            .body({
                                query: getAttachmentQuery(
                                    createdIssue.id,
                                    issue.number,
                                    repoFullName
                                )
                            })
                            .send()
                            .then(attachmentResponse => {
                                const attachmentData: {
                                    success: boolean;
                                    attachment: {
                                        id: string;
                                    };
                                } = attachmentResponse.json();
                                if (attachmentResponse.statusCode > 201)
                                    console.log(
                                        getOtherUpdateError(
                                            "attachment",
                                            {
                                                team: team,
                                                id: createdIssue.id,
                                                number: createdIssue.number
                                            },
                                            issue,
                                            attachmentResponse,
                                            attachmentData
                                        )
                                    );
                                else if (!attachmentData.success)
                                    console.log(
                                        `Failed to create attachment for ${team.key}-${createdIssue.number} [${createdIssue.id}] for GitHub issue #${issue.number} [${issue.id}], received status code ${attachmentResponse.statusCode}`,
                                        attachmentData
                                    );
                                else
                                    console.log(
                                        `Created attachment for ${team.key}-${createdIssue.number} [${createdIssue.id}] for GitHub issue #${issue.number} [${issue.id}].`
                                    );
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
        }
    }

    return res.status(200).send({
        success: true
    });
};

