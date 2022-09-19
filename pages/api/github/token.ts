import type { NextApiRequest, NextApiResponse } from "next";
import { GITHUB } from "../../../utils/constants";

// POST /api/github/token
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!req.body) {
        return res.status(400).send({ error: "Request is missing body" });
    }
    if (req.method !== "POST") {
        return res.status(405).send({
            message: "Only POST requests are accepted."
        });
    }

    const { refreshToken, redirectURI } = req.body;

    // Exchange auth code for access token
    const params = {
        code: refreshToken,
        redirect_uri: redirectURI,
        client_id: GITHUB.OAUTH_ID,
        client_secret: process.env.GITHUB_OAUTH_SECRET
    };
    try {
        const payload = await fetch(GITHUB.TOKEN_URL, {
            method: "POST",
            body: JSON.stringify(params),
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            }
        });

        const body = await payload.json();
        return res.status(200).json(body);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err });
    }
}

