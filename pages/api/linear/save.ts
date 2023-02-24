import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../prisma";

// POST /api/linear/save
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

    const {
        teamId,
        teamName,
        publicLabelId,
        canceledStateId,
        doneStateId,
        toDoStateId
    } = JSON.parse(req.body);

    if (!teamId) {
        return res
            .status(400)
            .send({ error: "Failed to save team: missing team ID" });
    } else if (!teamName) {
        return res
            .status(400)
            .send({ error: "Failed to save team: missing team name" });
    } else if (
        [publicLabelId, canceledStateId, doneStateId, toDoStateId].some(
            id => id === undefined
        )
    ) {
        return res
            .status(400)
            .send({ error: "Failed to save team: missing label or state" });
    }

    try {
        const result = await prisma.linearTeam.upsert({
            where: { teamId: teamId },
            update: {
                teamName,
                publicLabelId,
                canceledStateId,
                doneStateId,
                toDoStateId
            },
            create: {
                teamId,
                teamName,
                publicLabelId,
                canceledStateId,
                doneStateId,
                toDoStateId
            }
        });

        return res.status(200).json(result);
    } catch (err) {
        return res.status(400).send({
            error: `Failed to save team with error: ${err.message || ""}`
        });
    }
}

