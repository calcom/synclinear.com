import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../prisma";
import { Sync } from "../../typings";
import { GITHUB } from "../../utils/constants";

// POST /api/syncs
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!req.body)
        return res.status(400).send({ message: "Request is missing body" });
    if (req.method !== "POST") {
        return res.status(405).send({
            message: "Only POST requests are accepted."
        });
    }

    const body = JSON.parse(req.body);
    if (!body.accessToken) {
        return res
            .status(400)
            .send({ message: "Request is missing access token" });
    }

    // The security of this endpoint lies in the fact that user details can only be retrieved
    // with a valid GitHub access token, not a user ID.
    const response = await fetch(GITHUB.USER_ENDPOINT, {
        headers: { Authorization: `Bearer ${body.accessToken}` }
    });
    const user = await response.json();
    if (!user?.id) {
        return res.status(404).send({ message: "GitHub user not found" });
    }

    try {
        const syncs: Sync[] = await prisma.sync.findMany({
            where: {
                githubUserId: user.id
            },
            // Only return fields that are needed to identify a repo or team
            select: {
                LinearTeam: {
                    select: {
                        id: true,
                        teamName: true
                    }
                },
                GitHubRepo: {
                    select: {
                        id: true,
                        repoName: true
                    }
                }
            }
        });

        return res.status(200).json({
            syncs,
            name: user.name
        });
    } catch (err) {
        console.log("Error fetching syncs:", err.message);
        return res.status(404).send({ error: "Failed to fetch syncs" });
    }
}

