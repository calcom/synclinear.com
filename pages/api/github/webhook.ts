import type { NextApiRequest, NextApiResponse } from "next";

// POST /api/github/webhook
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== "POST") {
        return res.status(405).send({
            error: "Only POST requests are accepted"
        });
    }

    const { repoName, webhookUrl } = req.body;
    if (!repoName || !webhookUrl) {
        return res
            .status(400)
            .send({ error: "Request is missing repo name or webhook URL" });
    }

    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ error: "Request is missing auth token" });
    }

    try {
        const repoHooksResponse = await fetch(
            `https://api.github.com/repos/${repoName}/hooks`,
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `${token}`
                }
            }
        );
        const repoHooks = await repoHooksResponse.json();

        const hookExists = repoHooks.some(
            hook =>
                hook.config?.url === webhookUrl &&
                hook.config?.insecure_ssl === "0" &&
                hook.active === true
        );

        return res.status(200).json({ exists: hookExists });
    } catch (err) {
        return res.status(404).send({ error: err });
    }
}
