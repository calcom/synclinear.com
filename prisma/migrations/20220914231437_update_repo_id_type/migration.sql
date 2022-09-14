/*
  Warnings:

  - Changed the type of `repoId` on the `github_repos` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "github_repos" DROP COLUMN "repoId",
ADD COLUMN     "repoId" INTEGER NOT NULL;
