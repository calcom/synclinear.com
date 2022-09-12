import { VercelRequest, VercelResponse } from "@vercel/node";
import petitio from "petitio";
import { components } from "@octokit/openapi-types";
import { PrismaClient } from "@prisma/client";
import { LinearWebhookPayload } from "../../typings";
import { createHmac, timingSafeEqual } from "crypto";
import {
    IssueCommentCreatedEvent,
    IssuesEditedEvent,
    IssuesClosedEvent,
    IssuesOpenedEvent
} from "@octokit/webhooks-types";
import { LinearClient } from "@linear/sdk";

const LINEAR_PUBLIC_LABEL_ID = process.env.LINEAR_PUBLIC_LABEL_ID || "";
const LINEAR_CANCELED_STATE_ID = process.env.LINEAR_CANCELED_STATE_ID || "";
const LINEAR_DONE_STATE_ID = process.env.LINEAR_DONE_STATE_ID || "";
const LINEAR_TODO_STATE_ID = process.env.LINEAR_TODO_STATE_ID || "";

const prisma = new PrismaClient();
const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

const HMAC = createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET || "");

export default async (req: VercelRequest, res: VercelResponse) => {
    if (req.method !== "POST")
        return res.status(405).send({
            success: false,
            message: "Only POST requests are accepted."
        });
    else if (
        ["35.231.147.226", "35.243.134.228"].includes(
            req.socket.remoteAddress || ""
        ) &&
        !req.headers["x-hub-signature-256"]
    )
        return res.status(403).send({
            success: false,
            message: "Request not from Linear or GitHub."
        });

    if (req.headers["user-agent"] === "Linear-Webhook") {
        const webhookPayload: LinearWebhookPayload = req.body;

        if (
            webhookPayload.action === "update" &&
            webhookPayload.updatedFrom &&
            webhookPayload.data.labelIds.includes(LINEAR_PUBLIC_LABEL_ID)
        ) {
            if (
                webhookPayload.updatedFrom.labelIds &&
                !webhookPayload.updatedFrom.labelIds.includes(
                    LINEAR_PUBLIC_LABEL_ID
                )
            ) {
                const issueAlreadyExists = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: webhookPayload.data.id,
                        linearTeamId: webhookPayload.data.teamId
                    }
                });

                if (issueAlreadyExists) {
                    console.log(
                        `Not creating issue after label added as issue ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] already exists on GitHub as issue #${issueAlreadyExists.githubIssueNumber} [${issueAlreadyExists.githubIssueId}].`
                    );

                    return res.status(200).send({
                        success: true,
                        message: "Issue already exists on GitHub."
                    });
                }

                const issueCreator = await linear.user(
                    webhookPayload.data.creatorId
                );

                const createdIssueResponse = await petitio(
                    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues`,
                    "POST"
                )
                    .header(
                        "User-Agent",
                        `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                    )
                    .header(
                        "Authorization",
                        `token ${process.env.GITHUB_API_KEY}`
                    )
                    .body({
                        title: `[${webhookPayload.data.team.key}-${webhookPayload.data.number}] ${webhookPayload.data.title}`,
                        body: `${webhookPayload.data.description}${
                            issueCreator.id !== process.env.LINEAR_USER_ID
                                ? `\n<sub>${issueCreator.name} on Linear</sub>`
                                : ""
                        }`
                    })
                    .send();

                if (createdIssueResponse.statusCode !== 201) {
                    console.log(
                        `Failed to create GitHub issue for ${
                            webhookPayload.data.team.key
                        }-${webhookPayload.data.number}, received status code ${
                            createdIssueResponse.statusCode
                        }, body of ${JSON.stringify(
                            await createdIssueResponse.json(),
                            null,
                            4
                        )}.`
                    );

                    return res.status(500).send({
                        success: false,
                        message: `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`
                    });
                }

                let createdIssueData: components["schemas"]["issue"] =
                    await createdIssueResponse.json();

                const linearIssue = await linear.issue(webhookPayload.data.id);

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
                    petitio("https://api.linear.app/graphql", "POST")
                        .header(
                            "Authorization",
                            `Bearer ${process.env.LINEAR_API_KEY}`
                        )
                        .header("Content-Type", "application/json")
                        .body({
                            query: `mutation {
                                attachmentCreate(input:{
                                    issueId: "${webhookPayload.data.id}"
                                    title: "GitHub Issue #${createdIssueData.number}"
                                    subtitle: "Synchronized"
                                    url: "https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${createdIssueData.number}"
                                    iconUrl: "https://cdn.discordapp.com/attachments/937628023497297930/988735284504043520/github.png"
                                }) {
                                    success
                                    attachment {
                                        id
                                    }
                                }
                            }`
                        })
                        .send()
                        .then(attachmentResponse => {
                            const attachmentData: {
                                success: boolean;
                                attachment: {
                                    id: string;
                                };
                            } = attachmentResponse.json();
                            if (attachmentResponse.statusCode !== 201)
                                console.log(
                                    `Failed to create attachment for ${
                                        webhookPayload.data.team.key
                                    }-${webhookPayload.data.number} [${
                                        webhookPayload.data.id
                                    }] for GitHub issue #${
                                        createdIssueData.number
                                    } [${
                                        createdIssueData.id
                                    }], received status code ${
                                        createdIssueResponse.statusCode
                                    }, body of ${JSON.stringify(
                                        attachmentData,
                                        null,
                                        4
                                    )}.`
                                );
                            else if (!attachmentData.success)
                                console.log(
                                    `Failed to create attachment for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
                            else
                                console.log(
                                    `Created attachment for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
                        }),
                    prisma.syncedIssue.create({
                        data: {
                            githubIssueId: createdIssueData.id,
                            linearIssueId: webhookPayload.data.id,
                            linearTeamId: webhookPayload.data.teamId,
                            githubIssueNumber: createdIssueData.number,
                            linearIssueNumber: webhookPayload.data.number
                        }
                    })
                ] as Promise<any>[]);

                for (const linearComment of linearComments) {
                    if (!linearComment) continue;

                    const { comment, user } = linearComment;

                    await petitio(
                        `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${createdIssueData.number}/comments`,
                        "POST"
                    )
                        .header(
                            "User-Agent",
                            `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                        )
                        .header(
                            "Authorization",
                            `token ${process.env.GITHUB_API_KEY}`
                        )
                        .body({
                            body: `${comment.body}\n<sub>${user.name} on Linear</sub>`
                        })
                        .send()
                        .then(commentResponse => {
                            if (commentResponse.statusCode !== 201)
                                console.log(
                                    `Failed to create GitHub comment for ${
                                        webhookPayload.data.team.key
                                    }-${webhookPayload.data.number} [${
                                        webhookPayload.data.id
                                    }] on GitHub issue #${
                                        createdIssueData.number
                                    } [${
                                        createdIssueData.id
                                    }], received status code ${
                                        createdIssueResponse.statusCode
                                    }, body of ${JSON.stringify(
                                        commentResponse.json(),
                                        null,
                                        4
                                    )}.`
                                );
                            else
                                console.log(
                                    `Created comment on GitHub issue #${createdIssueData.number} [${createdIssueData.id}] for Linear issue ${webhookPayload.data.team.key}-${webhookPayload.data.number}.`
                                );
                        });
                }
            }

            if (webhookPayload.updatedFrom.title) {
                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearTeamId: webhookPayload.data.teamId,
                        linearIssueId: webhookPayload.data.id
                    }
                });

                if (!syncedIssue) {
                    console.log(
                        `Skipping over title change for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] as it is not synced.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `This is not a synced issue.`
                    });
                }

                await petitio(
                    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${syncedIssue.githubIssueNumber}`,
                    "PATCH"
                )
                    .header(
                        "User-Agent",
                        `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                    )
                    .header(
                        "Authorization",
                        `token ${process.env.GITHUB_API_KEY}`
                    )
                    .body({
                        title: `[${webhookPayload.data.team.key}-${webhookPayload.data.number}] ${webhookPayload.data.title}`
                    })
                    .send()
                    .then(updatedIssueResponse => {
                        if (updatedIssueResponse.statusCode !== 200)
                            console.log(
                                `Failed to update GitHub issue title for ${
                                    webhookPayload.data.team.key
                                }-${webhookPayload.data.number} [${
                                    webhookPayload.data.id
                                }] on GitHub issue #${
                                    syncedIssue.githubIssueNumber
                                } [${
                                    syncedIssue.githubIssueId
                                }], received status code ${
                                    updatedIssueResponse.statusCode
                                }, body of ${JSON.stringify(
                                    updatedIssueResponse,
                                    null,
                                    4
                                )}.`
                            );
                        else
                            console.log(
                                `Updated GitHub issue title for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            }

            if (webhookPayload.updatedFrom.description) {
                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: webhookPayload.data.id,
                        linearTeamId: webhookPayload.data.teamId
                    }
                });

                if (!syncedIssue) {
                    console.log(
                        `Skipping over description change for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] as it is not synced.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `This is not a synced issue.`
                    });
                }

                const issueCreator = await linear.user(
                    webhookPayload.data.creatorId
                );

                await petitio(
                    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${syncedIssue.githubIssueNumber}`,
                    "PATCH"
                )
                    .header(
                        "User-Agent",
                        `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                    )
                    .header(
                        "Authorization",
                        `token ${process.env.GITHUB_API_KEY}`
                    )
                    .body({
                        body: `${webhookPayload.data.description}${
                            issueCreator.id !== process.env.LINEAR_USER_ID
                                ? `\n<sub>${issueCreator.name} on Linear</sub>`
                                : ""
                        }`
                    })
                    .send()
                    .then(updatedIssueResponse => {
                        if (updatedIssueResponse.statusCode !== 200)
                            console.log(
                                `Failed to update GitHub issue description for ${
                                    webhookPayload.data.team.key
                                }-${webhookPayload.data.number} [${
                                    webhookPayload.data.id
                                }] on GitHub issue #${
                                    syncedIssue.githubIssueNumber
                                } [${
                                    syncedIssue.githubIssueId
                                }], received status code ${
                                    updatedIssueResponse.statusCode
                                }, body of ${JSON.stringify(
                                    updatedIssueResponse.json(),
                                    null,
                                    4
                                )}.`
                            );
                        else
                            console.log(
                                `Updated GitHub issue description for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            }

            if (webhookPayload.updatedFrom.stateId) {
                if (
                    webhookPayload.data.user?.id === process.env.LINEAR_USER_ID
                ) {
                    console.log(
                        `Skipping over state change for ${webhookPayload.data.team.key}-${webhookPayload.data.number} as it is caused by sync.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `Skipping over state change as it is created by sync.`
                    });
                }

                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: webhookPayload.data.id,
                        linearTeamId: webhookPayload.data.teamId
                    }
                });

                if (!syncedIssue) {
                    console.log(
                        `Skipping over state change for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] as it is not synced.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `This is not a synced issue.`
                    });
                }

                await petitio(
                    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${syncedIssue.githubIssueNumber}`,
                    "PATCH"
                )
                    .header(
                        "User-Agent",
                        `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                    )
                    .header(
                        "Authorization",
                        `token ${process.env.GITHUB_API_KEY}`
                    )
                    .body({
                        state: [
                            LINEAR_DONE_STATE_ID,
                            LINEAR_CANCELED_STATE_ID
                        ].includes(webhookPayload.data.stateId)
                            ? "closed"
                            : "open",
                        state_reason:
                            LINEAR_DONE_STATE_ID === webhookPayload.data.stateId
                                ? "completed"
                                : "not_planned"
                    })
                    .send()
                    .then(updatedIssueResponse => {
                        if (updatedIssueResponse.statusCode !== 200)
                            console.log(
                                `Failed to update GitHub issue state for ${
                                    webhookPayload.data.team.key
                                }-${webhookPayload.data.number} [${
                                    webhookPayload.data.id
                                }] on GitHub issue #${
                                    syncedIssue.githubIssueNumber
                                } [${
                                    syncedIssue.githubIssueId
                                }], received status code ${
                                    updatedIssueResponse.statusCode
                                }, body of ${JSON.stringify(
                                    updatedIssueResponse.json(),
                                    null,
                                    4
                                )}.`
                            );
                        else
                            console.log(
                                `Updated GitHub issue state for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            }
        }

        if (webhookPayload.action === "create") {
            if (webhookPayload.type === "Comment") {
                if (
                    webhookPayload.data.user?.id === process.env.LINEAR_USER_ID
                ) {
                    console.log(
                        `Skipping over comment creation for ${
                            webhookPayload.data.issue!.id
                        } as it is caused by sync.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `Skipping over comment as it is created by sync.`
                    });
                }

                const syncedIssue = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: webhookPayload.data.issueId
                    }
                });

                if (!syncedIssue) {
                    console.log(
                        `Skipping over comment for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] as it is not synced.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `This is not a synced issue.`
                    });
                }

                await petitio(
                    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${syncedIssue.githubIssueNumber}/comments`,
                    "POST"
                )
                    .header(
                        "User-Agent",
                        `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                    )
                    .header(
                        "Authorization",
                        `token ${process.env.GITHUB_API_KEY}`
                    )
                    .body({
                        body: `${webhookPayload.data.body}\n<sub>${
                            webhookPayload.data.user!.name
                        } on Linear</sub>`
                    })
                    .send()
                    .then(commentResponse => {
                        if (commentResponse.statusCode !== 201)
                            console.log(
                                `Failed to update GitHub issue state for ${
                                    webhookPayload.data.issue?.id
                                } on GitHub issue #${
                                    syncedIssue.githubIssueNumber
                                } [${
                                    syncedIssue.githubIssueId
                                }], received status code ${
                                    commentResponse.statusCode
                                }, body of ${JSON.stringify(
                                    commentResponse.json(),
                                    null,
                                    4
                                )}.`
                            );
                        else
                            console.log(
                                `Synced comment [${webhookPayload.data.id}] for ${webhookPayload.data.issue?.id} on GitHub issue #${syncedIssue.githubIssueNumber} [${syncedIssue.githubIssueId}].`
                            );
                    });
            } else if (
                webhookPayload.type === "Issue" &&
                webhookPayload.data.labelIds.includes(LINEAR_PUBLIC_LABEL_ID)
            ) {
                if (
                    webhookPayload.data.creatorId === process.env.LINEAR_USER_ID
                ) {
                    console.log(
                        `Skipping over issue creation for ${webhookPayload.data.id} as it is caused by sync.`
                    );

                    return res.status(200).send({
                        success: true,
                        message: `Skipping over issue as it is created by sync.`
                    });
                }

                const issueAlreadyExists = await prisma.syncedIssue.findFirst({
                    where: {
                        linearIssueId: webhookPayload.data.id,
                        linearTeamId: webhookPayload.data.teamId
                    }
                });

                if (issueAlreadyExists) {
                    console.log(
                        `Not creating issue after label added as issue ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] already exists on GitHub as issue #${issueAlreadyExists.githubIssueNumber} [${issueAlreadyExists.githubIssueId}].`
                    );

                    return res.status(200).send({
                        success: true,
                        message: "Issue already exists on GitHub."
                    });
                }

                const issueCreator = await linear.user(
                    webhookPayload.data.creatorId
                );

                const createdIssueResponse = await petitio(
                    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues`,
                    "POST"
                )
                    .header(
                        "User-Agent",
                        `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                    )
                    .header(
                        "Authorization",
                        `token ${process.env.GITHUB_API_KEY}`
                    )
                    .body({
                        title: `[${webhookPayload.data.team.key}-${webhookPayload.data.number}] ${webhookPayload.data.title}`,
                        body: `${webhookPayload.data.description}${
                            issueCreator.id !== process.env.LINEAR_USER_ID
                                ? `\n<sub>${issueCreator.name} on Linear</sub>`
                                : ""
                        }`
                    })
                    .send();

                if (createdIssueResponse.statusCode !== 201) {
                    console.log(
                        `Failed to create GitHub issue for ${
                            webhookPayload.data.team.key
                        }-${webhookPayload.data.number}, received status code ${
                            createdIssueResponse.statusCode
                        }, body of ${JSON.stringify(
                            await createdIssueResponse.json(),
                            null,
                            4
                        )}.`
                    );

                    return res.status(500).send({
                        success: false,
                        message: `I was unable to create an issue on Github. Status code: ${createdIssueResponse.statusCode}`
                    });
                }

                let createdIssueData: components["schemas"]["issue"] =
                    await createdIssueResponse.json();

                await Promise.all([
                    petitio("https://api.linear.app/graphql", "POST")
                        .header(
                            "Authorization",
                            `Bearer ${process.env.LINEAR_API_KEY}`
                        )
                        .header("Content-Type", "application/json")
                        .body({
                            query: `mutation {
                        attachmentCreate(input:{
                            issueId: "${webhookPayload.data.id}"
                            title: "GitHub Issue #${createdIssueData.number}"
                            subtitle: "Synchronized"
                            url: "https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${createdIssueData.number}"
                            iconUrl: "https://cdn.discordapp.com/attachments/937628023497297930/988735284504043520/github.png"
                        }) {
                            success
                            attachment {
                                id
                            }
                        }
                    }`
                        })
                        .send()
                        .then(attachmentResponse => {
                            const attachmentData: {
                                success: boolean;
                                attachment: {
                                    id: string;
                                };
                            } = attachmentResponse.json();
                            if (attachmentResponse.statusCode !== 201)
                                console.log(
                                    `Failed to create attachment for ${
                                        webhookPayload.data.team.key
                                    }-${webhookPayload.data.number} [${
                                        webhookPayload.data.id
                                    }] for GitHub issue #${
                                        createdIssueData.number
                                    } [${
                                        createdIssueData.id
                                    }], received status code ${
                                        createdIssueResponse.statusCode
                                    }, body of ${JSON.stringify(
                                        attachmentData,
                                        null,
                                        4
                                    )}.`
                                );
                            else if (!attachmentData.success)
                                console.log(
                                    `Failed to create attachment for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
                            else
                                console.log(
                                    `Created attachment for ${webhookPayload.data.team.key}-${webhookPayload.data.number} [${webhookPayload.data.id}] for GitHub issue #${createdIssueData.number} [${createdIssueData.id}].`
                                );
                        }),
                    prisma.syncedIssue.create({
                        data: {
                            githubIssueId: createdIssueData.id,
                            linearIssueId: webhookPayload.data.id,
                            linearTeamId: webhookPayload.data.teamId,
                            githubIssueNumber: createdIssueData.number,
                            linearIssueNumber: webhookPayload.data.number
                        }
                    })
                ]);
            }
        }
    } else {
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

        if (req.body.sender.login === "spacedrive-bot") {
            console.log(`Skipping over request as it is created by sync.`);

            return res.status(200).send({
                success: true,
                message: `Skipping over request as it is created by sync.`
            });
        }

        if (
            req.headers["x-github-event"] === "issue_comment" &&
            req.body.action === "created"
        ) {
            const webhookPayload: IssueCommentCreatedEvent = req.body;

            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    githubIssueNumber: webhookPayload.issue.number
                }
            });

            if (!syncedIssue) {
                console.log(
                    `Skipping over comment for GitHub issue #${webhookPayload.issue.number} as it is not synced.`
                );

                return res.status(200).send({
                    success: true,
                    message: `This is not a synced issue.`
                });
            }

            await linear
                .commentCreate({
                    issueId: syncedIssue.linearIssueId,
                    body: `${webhookPayload.comment.body}\n— [${webhookPayload.sender.login}](${webhookPayload.sender.html_url}) on GitHub`
                })
                .then(comment => {
                    comment.comment?.then(commentData => {
                        commentData.issue?.then(issueData => {
                            issueData.team?.then(teamData => {
                                if (!comment.success)
                                    console.log(
                                        `Failed to create comment for ${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueNumber}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                    );
                                else
                                    console.log(
                                        `Created comment for ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                    );
                            });
                        });
                    });
                });
        } else if (
            req.headers["x-github-event"] === "issues" &&
            req.body.action === "edited"
        ) {
            const webhookPayload: IssuesEditedEvent = req.body;

            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    githubIssueNumber: webhookPayload.issue.number
                }
            });

            if (!syncedIssue) {
                console.log(
                    `Skipping over issue edit for GitHub issue #${webhookPayload.issue.number} as it is not synced.`
                );

                return res.status(200).send({
                    success: true,
                    message: `This is not a synced issue.`
                });
            }

            const title = webhookPayload.issue.title.split(
                `${syncedIssue.linearIssueNumber}]`
            );
            if (title.length > 1) title.shift();

            const description = webhookPayload.issue.body?.split("<sub>");
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
                                    `Failed to edit issue for ${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueNumber}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                );
                            else
                                console.log(
                                    `Edited issue ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                );
                        });
                    });
                });
        } else if (
            req.headers["x-github-event"] === "issues" &&
            ["closed", "reopened"].includes(req.body.action)
        ) {
            const webhookPayload: IssuesClosedEvent = req.body;

            const syncedIssue = await prisma.syncedIssue.findFirst({
                where: {
                    githubIssueNumber: webhookPayload.issue.number
                }
            });

            if (!syncedIssue) {
                console.log(
                    `Skipping over issue edit for GitHub issue #${webhookPayload.issue.number} as it is not synced.`
                );

                return res.status(200).send({
                    success: true,
                    message: `This is not a synced issue.`
                });
            }

            const title = webhookPayload.issue.title.split(
                `${syncedIssue.linearIssueNumber}]`
            );
            if (title.length > 1) title.shift();

            await linear
                .issueUpdate(syncedIssue.linearIssueId, {
                    stateId:
                        webhookPayload.issue.state_reason === "not_planned"
                            ? LINEAR_CANCELED_STATE_ID
                            : webhookPayload.issue.state_reason === "completed"
                            ? LINEAR_DONE_STATE_ID
                            : LINEAR_TODO_STATE_ID
                })
                .then(updatedIssue => {
                    console.log(-1);
                    updatedIssue.issue?.then(updatedIssueData => {
                        console.log(-2);
                        updatedIssueData.team?.then(teamData => {
                            if (!updatedIssue.success)
                                console.log(
                                    `Failed to change state for ${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueNumber}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                );
                            else
                                console.log(
                                    `Changed state ${teamData.key}-${syncedIssue.linearIssueNumber} [${syncedIssue.linearIssueId}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                );
                        });
                    });
                });
        } else if (
            req.headers["x-github-event"] === "issues" &&
            req.body.action === "opened"
        ) {
            const webhookPayload: IssuesOpenedEvent = req.body;

            const createdIssueData = await linear.issueCreate({
                title: webhookPayload.issue.title,
                description: webhookPayload.issue.body,
                teamId: process.env.LINEAR_TEAM_ID || "",
                labelIds: [process.env.LINEAR_PUBLIC_LABEL_ID || ""]
            });

            if (!createdIssueData.success) {
                console.log(
                    `Failed to create issue for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                );

                return res.status(500).send({
                    success: false,
                    message: `Failed creating issue on Linear.`
                });
            }

            const createdIssue = await createdIssueData.issue;

            if (!createdIssue)
                console.log(
                    `Failed to fetch issue I just created for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                );
            else {
                const team = await createdIssue.team;

                if (!team) {
                    console.log(
                        `Failed to fetch team for issue, ${createdIssue.id} for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                    );
                } else {
                    await Promise.all([
                        petitio(
                            `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${webhookPayload.issue.number}`,
                            "PATCH"
                        )
                            .header(
                                "User-Agent",
                                `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}, linear-github-sync`
                            )
                            .header(
                                "Authorization",
                                `token ${process.env.GITHUB_API_KEY}`
                            )
                            .body({
                                title: `[${team.key}-${createdIssue.number}] ${webhookPayload.issue.title}`
                            })
                            .send()
                            .then(titleRenameResponse => {
                                if (titleRenameResponse.statusCode !== 200)
                                    console.log(
                                        `Failed to update GitHub issue title for ${
                                            team.key
                                        }-${createdIssue.number} [${
                                            createdIssue.id
                                        }] on GitHub issue #${
                                            webhookPayload.issue.number
                                        } [${
                                            webhookPayload.issue.id
                                        }], received status code ${
                                            titleRenameResponse.statusCode
                                        }, body of ${JSON.stringify(
                                            titleRenameResponse.json(),
                                            null,
                                            4
                                        )}.`
                                    );
                                else
                                    console.log(
                                        `Created comment on GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}] for Linear issue ${team.key}-${createdIssue.number}.`
                                    );
                            }),
                        petitio("https://api.linear.app/graphql", "POST")
                            .header(
                                "Authorization",
                                `Bearer ${process.env.LINEAR_API_KEY}`
                            )
                            .header("Content-Type", "application/json")
                            .body({
                                query: `mutation {
                        attachmentCreate(input:{
                            issueId: "${createdIssue.id}"
                            title: "GitHub Issue #${webhookPayload.issue.number}"
                            subtitle: "Synchronized"
                            url: "https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/${webhookPayload.issue.number}"
                            iconUrl: "https://cdn.discordapp.com/attachments/937628023497297930/988735284504043520/github.png"
                        }) {
                            success
                            attachment {
                                id
                            }
                        }
                    }`
                            })
                            .send()
                            .then(attachmentResponse => {
                                const attachmentData: {
                                    success: boolean;
                                    attachment: {
                                        id: string;
                                    };
                                } = attachmentResponse.json();
                                if (attachmentResponse.statusCode !== 200)
                                    console.log(
                                        `Failed to create attachment for ${
                                            team.key
                                        }-${createdIssue.number} [${
                                            createdIssue.id
                                        }] for GitHub issue #${
                                            webhookPayload.issue.number
                                        } [${
                                            webhookPayload.issue.id
                                        }], received status code ${
                                            attachmentResponse.statusCode
                                        }, body of ${JSON.stringify(
                                            attachmentData,
                                            null,
                                            4
                                        )}.`
                                    );
                                else if (!attachmentData.success)
                                    console.log(
                                        `Failed to create attachment for ${team.key}-${createdIssue.number} [${createdIssue.id}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}], received status code ${attachmentResponse.statusCode}`,
                                        attachmentData
                                    );
                                else
                                    console.log(
                                        `Created attachment for ${team.key}-${createdIssue.number} [${createdIssue.id}] for GitHub issue #${webhookPayload.issue.number} [${webhookPayload.issue.id}].`
                                    );
                            }),
                        prisma.syncedIssue.create({
                            data: {
                                githubIssueNumber: webhookPayload.issue.number,
                                githubIssueId: webhookPayload.issue.id,
                                linearIssueId: createdIssue.id,
                                linearIssueNumber: createdIssue.number,
                                linearTeamId: team.id
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

