import type { NextApiRequest, NextApiResponse } from "next";
import { LINEAR } from "../../../utils/constants";

// POST /api/linear/token
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

    if (!refreshToken || !redirectURI) {
        return res.status(400).send({ error: "Missing token or redirect URI" });
    }

    // Exchange auth code for access token
    const tokenParams = new URLSearchParams({
        code: refreshToken,
        redirect_uri: redirectURI,
        client_id: LINEAR.OAUTH_ID,
        client_secret: process.env.LINEAR_OAUTH_SECRET,
        grant_type: "authorization_code"
    });
    try {
        const payload = await fetch(LINEAR.TOKEN_URL, {
            method: "POST",
            body: tokenParams,
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        const body = await payload.json();
        return res.status(200).json(body);
    } catch (err) {
        console.error(err);
        return res.status(500).send({ error: err });
    }
}

