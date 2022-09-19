/*
  Warnings:

  - Added the required column `apiKey` to the `github_repos` table without a default value. This is not possible if the table is not empty.
  - Added the required column `apiKeyInitVector` to the `github_repos` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "github_repos" ADD COLUMN     "apiKey" TEXT NOT NULL,
ADD COLUMN     "apiKeyInitVector" TEXT NOT NULL;
