import type { NextApiRequest, NextApiResponse } from "next";
import { createLabel } from "../utils";

// POST /api/github/label
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== "POST") {
        return res.setHeader("Allow", "POST").status(405).send({
            error: "Only POST requests are accepted"
        });
    }

    const { repoName, label } = req.body;
    if (!repoName || !label) {
        return res
            .status(400)
            .send({ error: "Request is missing repo name or label details" });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ error: "Request is missing auth token" });
    }

    try {
        const { createdLabel, error } = await createLabel({
            repoFullName: repoName,
            label,
            githubAuthHeader: authHeader,
            userAgentHeader: `${repoName}, linear-github-sync`
        });

        if (error) {
            throw error;
        }

        return res.status(200).json({ createdLabel });
    } catch (err) {
        return res.status(404).send({ error: err });
    }
}

