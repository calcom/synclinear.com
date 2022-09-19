import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../prisma";
import { encrypt } from "../../../utils";

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

    const { repoId, name, webhookSecret, apiKey } = JSON.parse(req.body);

    // Encrypt the API key
    const { hash: apiKeyEncrypted, initVector: apiKeyInitVector } =
        encrypt(apiKey);

    const result = await prisma.gitHubRepo.create({
        data: {
            repoId,
            name,
            webhookSecret,
            apiKey: apiKeyEncrypted,
            apiKeyInitVector
        }
    });

    res.status(200).json(result);
}

