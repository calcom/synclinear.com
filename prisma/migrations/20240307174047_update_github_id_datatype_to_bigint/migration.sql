-- DropForeignKey
ALTER TABLE "milestones" DROP CONSTRAINT "milestones_githubRepoId_fkey";

-- DropForeignKey
ALTER TABLE "synced_issues" DROP CONSTRAINT "synced_issues_githubRepoId_fkey";

-- DropForeignKey
ALTER TABLE "syncs" DROP CONSTRAINT "syncs_githubRepoId_fkey";

-- AlterTable
ALTER TABLE "github_repos" ALTER COLUMN "repoId" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "milestones" ALTER COLUMN "githubRepoId" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "synced_issues" ALTER COLUMN "githubIssueNumber" SET DATA TYPE BIGINT,
ALTER COLUMN "githubIssueId" SET DATA TYPE BIGINT,
ALTER COLUMN "githubRepoId" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "syncs" ALTER COLUMN "githubUserId" SET DATA TYPE BIGINT,
ALTER COLUMN "githubRepoId" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "githubUserId" SET DATA TYPE BIGINT;

-- AddForeignKey
ALTER TABLE "synced_issues" ADD CONSTRAINT "synced_issues_githubRepoId_fkey" FOREIGN KEY ("githubRepoId") REFERENCES "github_repos"("repoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syncs" ADD CONSTRAINT "syncs_githubRepoId_fkey" FOREIGN KEY ("githubRepoId") REFERENCES "github_repos"("repoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_githubRepoId_fkey" FOREIGN KEY ("githubRepoId") REFERENCES "github_repos"("repoId") ON DELETE RESTRICT ON UPDATE CASCADE;
