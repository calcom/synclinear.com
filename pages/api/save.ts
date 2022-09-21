import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../prisma";
import { encrypt } from "../../utils";

// POST /api/save
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!req.body)
        return res.status(400).send({ error: "Request is missing body" });
    if (req.method !== "POST")
        return res.status(405).send({
            message: "Only POST requests are accepted."
        });

    const body = JSON.parse(req.body);

    // Encrypt the API keys
    const { hash: linearApiKey, initVector: linearApiKeyIV } = encrypt(
        body.linear.apiKey
    );
    const { hash: githubApiKey, initVector: githubApiKeyIV } = encrypt(
        body.github.apiKey
    );

    const data = {
        // GitHub
        githubUserId: body.github.userId,
        githubRepoId: body.github.repoId,
        githubWebhookSecret: body.github.webhookSecret,
        githubApiKey,
        githubApiKeyIV,

        // Linear
        linearUserId: body.linear.userId,
        linearTeamId: body.linear.teamId,
        linearApiKey,
        linearApiKeyIV
    };

    const result = await prisma.sync.create({
        data
    });

    res.status(200).json(result);
}

