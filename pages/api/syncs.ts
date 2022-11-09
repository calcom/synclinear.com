import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../prisma";
import { Sync } from "../../typings";
import { GITHUB } from "../../utils/constants";

// POST/DELETE /api/syncs
export default async function handle(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!req.body)
        return res.status(400).send({ message: "Request is missing body" });

    const body = JSON.parse(req.body);

    if (req.method === "POST") {
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
                    id: true,
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
                user: { name: user.name, id: user.id }
            });
        } catch (error) {
            console.log("Error fetching syncs: ", error.message);
            return res.status(404).send({ message: "Failed to fetch syncs" });
        }
    } else if (req.method === "DELETE") {
        // Delete a sync
        if (!body.syncId) {
            return res
                .status(400)
                .send({ message: "Request is missing sync ID" });
        }

        // The security of this endpoint lies in the fact that user has a valid GH token
        const response = await fetch(GITHUB.USER_ENDPOINT, {
            headers: { Authorization: `Bearer ${body.accessToken}` }
        });
        const user = await response.json();
        if (!user?.id) {
            return res
                .status(403)
                .send({ message: "Must be logged in to delete" });
        }

        try {
            console.log("Deleting sync: ", body.syncId);
            await prisma.sync.delete({
                where: { id: body.syncId }
            });
            return res.status(200).send({ message: "Sync deleted" });
        } catch (error) {
            console.log("Error deleting sync: ", error.message);
            return res.status(404).send({ error: "Failed to delete sync" });
        }
    } else {
        return res.status(405).send({
            message: "Request type not supported."
        });
    }
}

