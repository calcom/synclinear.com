import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../prisma";
import { encrypt } from "../../utils";

// POST /api/save
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!req.body)
        return res.status(400).send({ message: "Request is missing body" });
    if (req.method !== "POST") {
        return res.status(405).send({
            message: "Only POST requests are accepted."
        });
    }

    const { github, linear } = JSON.parse(req.body);

    // Check for each required field
    if (!github?.userId) {
        return res
            .status(404)
            .send({ error: "Failed to save sync: missing GH user ID" });
    } else if (!github?.repoId) {
        return res
            .status(404)
            .send({ error: "Failed to save sync: missing GH repo ID" });
    } else if (!linear?.userId) {
        return res
            .status(404)
            .send({ error: "Failed to save sync: missing Linear user ID" });
    } else if (!linear?.teamId) {
        return res
            .status(404)
            .send({ error: "Failed to save sync: missing Linear team ID" });
    } else if (!linear?.apiKey || !github?.apiKey) {
        return res
            .status(404)
            .send({ error: "Failed to save sync: missing API key" });
    }

    // Encrypt the API keys
    const { hash: linearApiKey, initVector: linearApiKeyIV } = encrypt(
        linear.apiKey
    );
    const { hash: githubApiKey, initVector: githubApiKeyIV } = encrypt(
        github.apiKey
    );

    try {
        await prisma.sync.upsert({
            where: {
                githubUserId_linearUserId_githubRepoId_linearTeamId: {
                    githubUserId: github.userId,
                    githubRepoId: github.repoId,
                    linearUserId: linear.userId,
                    linearTeamId: linear.teamId
                }
            },
            update: {
                githubApiKey,
                githubApiKeyIV,
                linearApiKey,
                linearApiKeyIV
            },
            create: {
                // GitHub
                githubUserId: github.userId,
                githubRepoId: github.repoId,
                githubApiKey,
                githubApiKeyIV,

                // Linear
                linearUserId: linear.userId,
                linearTeamId: linear.teamId,
                linearApiKey,
                linearApiKeyIV
            }
        });

        return res.status(200).send({ message: "Saved successfully" });
    } catch (err) {
        console.log("Error saving sync:", err.message);
        return res.status(404).send({
            error: `Failed to save sync with error: ${err.message || ""}`
        });
    }
}

