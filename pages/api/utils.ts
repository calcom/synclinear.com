import { LinearClient } from "@linear/sdk";
import got from "got";
import type { NextApiResponse } from "next/types";
import prisma from "../../prisma";
import { GitHubIssueLabel } from "../../typings";
import { GITHUB } from "../../utils/constants";

/**
 * Server-only utility functions
 */
export default (_, res: NextApiResponse) => {
    return res.status(200).send({ message: "Nothing to see here!" });
};

/**
 * Map a Linear username to a GitHub username in the database if not already mapped
 *
 * @param {LinearClient} linearClient to get the authenticated Linear user's info
 * @param {number} githubUserId
 * @param {string} linearUserId
 * @param {string} userAgentHeader to respect GitHub API's policies
 * @param {string} githubAuthHeader to get the authenticated GitHub user's info
 */
export const upsertUser = async (
    linearClient: LinearClient,
    githubUserId: number,
    linearUserId: string,
    userAgentHeader: string,
    githubAuthHeader: string
): Promise<void> => {
    const existingUser = await prisma.user.findFirst({
        where: {
            AND: {
                githubUserId: githubUserId,
                linearUserId: linearUserId
            }
        }
    });

    if (!existingUser) {
        console.log("Adding user to users table");

        const linearUser = await linearClient.viewer;

        const githubUserResponse = await got.get(
            `https://api.github.com/user`,
            {
                headers: {
                    "User-Agent": userAgentHeader,
                    Authorization: githubAuthHeader
                }
            }
        );
        const githubUserBody = JSON.parse(githubUserResponse.body);

        await prisma.user.upsert({
            where: {
                githubUserId_linearUserId: {
                    githubUserId: githubUserId,
                    linearUserId: linearUserId
                }
            },
            update: {
                githubUsername: githubUserBody.login,
                githubEmail: githubUserBody.email ?? "",
                linearUsername: linearUser.displayName,
                linearEmail: linearUser.email ?? ""
            },
            create: {
                githubUserId: githubUserId,
                linearUserId: linearUserId,
                githubUsername: githubUserBody.login,
                githubEmail: githubUserBody.email ?? "",
                linearUsername: linearUser.displayName,
                linearEmail: linearUser.email ?? ""
            }
        });
    }

    return;
};

/**
 * Translate users' usernames from one platform to the other
 * @param {string[]} usernames of Linear or GitHub users
 * @returns {string[]} Linear and GitHub usernames corresponding to the provided usernames
 */
export const mapUsernames = async (
    usernames: string[],
    platform: "linear" | "github"
): Promise<Array<{ githubUsername: string; linearUsername: string }>> => {
    console.log(`Mapping ${platform} usernames`);

    const filters = usernames.map((username: string) => {
        return { [`${platform}Username`]: username };
    });

    const existingUsers = await prisma.user.findMany({
        where: {
            OR: filters
        },
        select: {
            githubUsername: true,
            linearUsername: true
        }
    });

    if (!existingUsers?.length) return [];

    return existingUsers;
};

/**
 * Replace all mentions of users with their username in the corresponding platform
 * @param {string} body the message to be sent
 * @returns {string} the message with all mentions replaced
 */
export const replaceMentions = async (
    body: string,
    platform: "linear" | "github"
) => {
    if (!body?.match(/(?<=@)\w+/g)) return body;

    console.log(`Replacing ${platform} mentions`);

    let sanitizedBody = body;

    const mentionMatches = sanitizedBody.matchAll(/(?<=@)\w+/g) ?? [];
    const userMentions =
        Array.from(mentionMatches)?.map(mention => mention?.[0]) ?? [];

    const userMentionReplacements = await mapUsernames(userMentions, platform);

    userMentionReplacements.forEach(mention => {
        sanitizedBody = sanitizedBody.replace(
            new RegExp(`@${mention[`${platform}Username`]}`, "g"),
            `@${
                mention[
                    `${platform === "linear" ? "github" : "linear"}Username`
                ]
            }`
        );
    });

    return sanitizedBody;
};

export const createLabel = async ({
    repoFullName,
    label,
    githubAuthHeader,
    userAgentHeader
}: {
    repoFullName: string;
    label: GitHubIssueLabel;
    githubAuthHeader: string;
    userAgentHeader: string;
}): Promise<{
    createdLabel?: { name: string } | undefined;
    error?: boolean;
}> => {
    let error = false;

    const createdLabelResponse = await got.post(
        `${GITHUB.REPO_ENDPOINT}/${repoFullName}/labels`,
        {
            json: {
                name: label.name,
                color: label.color?.replace("#", ""),
                description: "Created by Linear-GitHub Sync"
            },
            headers: {
                Authorization: githubAuthHeader,
                "User-Agent": userAgentHeader
            },
            throwHttpErrors: false
        }
    );

    const createdLabel = JSON.parse(createdLabelResponse.body);

    if (
        createdLabelResponse.statusCode > 201 &&
        createdLabel.errors?.[0]?.code !== "already_exists"
    ) {
        error = true;
    } else if (createdLabel.errors?.[0]?.code === "already_exists") {
        return { error: false };
    }

    return { createdLabel, error };
};

export const applyLabel = async ({
    repoFullName,
    issueNumber,
    labelNames,
    githubAuthHeader,
    userAgentHeader
}: {
    repoFullName: string;
    issueNumber: number;
    labelNames: string[];
    githubAuthHeader: string;
    userAgentHeader: string;
}): Promise<{ error: boolean }> => {
    let error = false;

    const appliedLabelResponse = await got.post(
        `${GITHUB.REPO_ENDPOINT}/${repoFullName}/issues/${issueNumber}/labels`,
        {
            json: {
                labels: labelNames
            },
            headers: {
                Authorization: githubAuthHeader,
                "User-Agent": userAgentHeader
            }
        }
    );

    if (appliedLabelResponse.statusCode > 201) {
        error = true;
    }

    return { error };
};

export const createComment = async ({
    repoFullName,
    issueNumber,
    body,
    githubAuthHeader,
    userAgentHeader
}: {
    repoFullName: string;
    issueNumber: number;
    body: string;
    githubAuthHeader: string;
    userAgentHeader: string;
}): Promise<{ error: boolean }> => {
    let error = false;

    const commentResponse = await got.post(
        `${GITHUB.REPO_ENDPOINT}/${repoFullName}/${issueNumber}/comments`,
        {
            json: {
                body
            },
            headers: {
                Authorization: githubAuthHeader,
                "User-Agent": userAgentHeader
            }
        }
    );

    if (commentResponse.statusCode > 201) {
        error = true;
    }

    return { error };
};
