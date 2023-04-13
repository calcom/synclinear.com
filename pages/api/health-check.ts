import type { NextApiResponse } from "next";
import prisma from "../../prisma";

// GET /api/health-check
export default async function handle(_, res: NextApiResponse) {
    if (!process.env.DATABASE_URL) {
        return res
            .status(404)
            .send(
                "No database URL found. Check the DATABASE_URL environment variable."
            );
    }

    try {
        await prisma.$connect();
        return res.status(200).send("Successfully connected to the database!");
    } catch (e) {
        console.error(e);
        return res
            .status(503)
            .send(
                "Unable to connect to the database. Check your connection string."
            );
    }
}

