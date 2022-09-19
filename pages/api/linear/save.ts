import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../prisma";
import { encrypt } from "../../../utils";

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
        userId,
        userName,
        teamId,
        teamName,
        apiKey,
        publicLabelId,
        canceledStateId,
        doneStateId,
        toDoStateId,
        inProgressStateId
    } = JSON.parse(req.body);

    // Encrypt the API key
    const { hash: apiKeyEncrypted, initVector: apiKeyInitVector } =
        encrypt(apiKey);

    const result = await prisma.linearTeam.create({
        data: {
            userId,
            userName,
            teamId,
            teamName,
            apiKey: apiKeyEncrypted,
            apiKeyInitVector,
            publicLabelId,
            canceledStateId,
            doneStateId,
            toDoStateId,
            inProgressStateId
        }
    });

    res.json(result);
}

