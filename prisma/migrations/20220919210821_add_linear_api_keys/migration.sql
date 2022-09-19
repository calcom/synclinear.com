/*
  Warnings:

  - Added the required column `apiKey` to the `linear_teams` table without a default value. This is not possible if the table is not empty.
  - Added the required column `apiKeyInitVector` to the `linear_teams` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "linear_teams" ADD COLUMN     "apiKey" TEXT NOT NULL,
ADD COLUMN     "apiKeyInitVector" TEXT NOT NULL;
