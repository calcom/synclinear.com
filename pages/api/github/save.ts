import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../prisma";

// POST /api/github/save
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

    const { repoId, repoName, webhookSecret } = JSON.parse(req.body);

    try {
        const result = await prisma.gitHubRepo.upsert({
            where: { repoId: repoId },
            update: { repoName, webhookSecret },
            create: {
                repoId,
                repoName,
                webhookSecret
            }
        });

        return res.status(200).json(result);
    } catch (err) {
        return res.status(404).send({ error: err });
    }
}

