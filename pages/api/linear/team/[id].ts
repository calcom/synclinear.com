import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../../prisma";

// GET /api/linear/team/:id
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

    if (!id) {
        return res.status(400).send({ error: "Request is missing team ID" });
    }

    try {
        const count: number = await prisma.linearTeam.count({
            where: { teamId: `${id}` }
        });

        return res.status(200).json({ exists: count > 0 });
    } catch (err) {
        return res.status(404).send({ error: err });
    }
}

