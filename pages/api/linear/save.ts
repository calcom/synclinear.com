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

    res.json(result);
}

