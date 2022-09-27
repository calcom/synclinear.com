import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../../prisma";

// GET /api/github/repo/:id
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== "GET") {
        return res.status(405).send({
            error: "Only GET requests are accepted"
        });
    }

    const { id } = req.query;
    const parsed = parseInt(`${id}`);
    if (!parsed || isNaN(parsed)) {
        return res
            .status(400)
            .send({ error: "Request is missing repo ID (number)" });
    }

    try {
        const count: number = await prisma.gitHubRepo.count({
            where: { repoId: parsed }
        });

        return res.status(200).json({ exists: count > 0 });
    } catch (err) {
        return res.status(404).send({ error: err });
    }
}

