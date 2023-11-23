import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../prisma";

// POST /api/github/repo
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== "POST") {
        return res.setHeader("Allow", "POST").status(405).send({
            error: "Only POST requests are accepted"
        });
    }

    const { repoId } = JSON.parse(req.body);

    if (!repoId || isNaN(repoId)) {
        return res.status(400).send({ error: "Request is missing repo ID" });
    }

    try {
        const inDb = repoId
            ? await prisma.gitHubRepo.findFirst({
                  where: { repoId: Number(repoId) }
              })
            : false;

        return res.status(200).json({ inDb });
    } catch (err) {
        console.error(err);
        return res.status(404).send({ error: err });
    }
}

