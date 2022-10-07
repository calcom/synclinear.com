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

    const body = JSON.parse(req.body);

    // Encrypt the API keys
    const { hash: linearApiKey, initVector: linearApiKeyIV } = encrypt(
        body.linear.apiKey
    );
    const { hash: githubApiKey, initVector: githubApiKeyIV } = encrypt(
        body.github.apiKey
    );

    try {
        await prisma.sync.upsert({
            where: {
                githubUserId_linearUserId_githubRepoId_linearTeamId: {
                    githubUserId: body.github.userId,
                    githubRepoId: body.github.repoId,
                    linearUserId: body.linear.userId,
                    linearTeamId: body.linear.teamId
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
                githubUserId: body.github.userId,
                githubRepoId: body.github.repoId,
                githubApiKey,
                githubApiKeyIV,

                // Linear
                linearUserId: body.linear.userId,
                linearTeamId: body.linear.teamId,
                linearApiKey,
                linearApiKeyIV
            }
        });

        return res.status(200).send({ message: "Saved successfully" });
    } catch (err) {
        console.log("Error saving sync:", err.message);
        return res.status(404).send({ error: "Failed to save sync" });
    }
}

