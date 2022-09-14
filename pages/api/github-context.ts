import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../prisma";

// POST /api/github-context
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

    const { repoId, name, webhookSecret } = JSON.parse(req.body);

    const result = await prisma.gitHubRepo.create({
        data: {
            repoId,
            name,
            webhookSecret
        }
    });

    res.json(result);
}

