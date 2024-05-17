/**
 * This script updated all the github issues with updated linear image's expiry
 */

import { PrismaClient } from "@prisma/client";
import got from "got";
import { decrypt, getSyncFooter } from "../utils";
import { GITHUB, LINEAR } from "../utils/constants";
import { LinearClient } from "@linear/sdk";
import { prepareMarkdownContent } from "../pages/api/utils";

const GITHUB_REPO_FULL_NAME = "rockingrohit9639/testing-synclinear";

const prisma = new PrismaClient();
async function main() {
    const sync = await prisma.sync.findFirst({
        where: { GitHubRepo: { repoName: GITHUB_REPO_FULL_NAME } }
    });
    if (!sync) {
        return;
    }

    const githubKey = process.env.GITHUB_API_KEY
        ? process.env.GITHUB_API_KEY
        : decrypt(sync.githubApiKey, sync.githubApiKeyIV);
    const githubAuthHeader = `token ${githubKey}`;
    const userAgentHeader = `${GITHUB_REPO_FULL_NAME}, linear-github-sync`;

    const defaultGithubHeaders = {
        Authorization: githubAuthHeader,
        "User-Agent": userAgentHeader,
        Accept: "application/vnd.github+json"
    };

    const linearKey = process.env.LINEAR_API_KEY
        ? process.env.LINEAR_API_KEY
        : decrypt(sync.linearApiKey, sync.linearApiKeyIV);

    const syncedIssues = await prisma.syncedIssue.findMany({
        where: { GitHubRepo: { repoName: GITHUB_REPO_FULL_NAME } }
    });

    const linear = new LinearClient({
        apiKey: linearKey,
        headers: {
            ...LINEAR.PUBLIC_QUERY_HEADERS
        }
    });

    for (const syncedIssue of syncedIssues) {
        try {
            const linearIssue = await linear.issue(syncedIssue.linearIssueId);
            const ticketName = linearIssue.identifier;
            const url = linearIssue.url;

            const modifiedDescription = await prepareMarkdownContent(
                linearIssue.description,
                "linear"
            );

            const updatedIssueResponse = await got.patch(
                `${GITHUB.REPO_ENDPOINT}/${GITHUB_REPO_FULL_NAME}/issues/${syncedIssue.githubIssueNumber}`,
                {
                    headers: defaultGithubHeaders,
                    json: {
                        body: `${
                            modifiedDescription ?? ""
                        }\n\n<sub>${getSyncFooter()} | [${ticketName}](${url})</sub>`
                    }
                }
            );

            if (updatedIssueResponse.statusCode === 200) {
                console.log(
                    `🟩🟩 Updated issue - ${syncedIssue.githubIssueId} 🟩🟩`
                );
            }
        } catch {
            console.log(
                `🟥🟥 Something went wrong while updating issue - ${syncedIssue.id}🟥🟥`
            );
        }
    }
}

main().then(() => {
    console.log("🟩🟩 Script completed successfully!🟩🟩");
});
