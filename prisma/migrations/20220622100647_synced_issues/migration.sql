-- CreateTable
CREATE TABLE "synced_issues" (
    "id" TEXT NOT NULL,
    "githubIssueNumber" INTEGER NOT NULL,
    "linearIssueNumber" INTEGER NOT NULL,
    "githubIssueId" INTEGER NOT NULL,
    "linearIssueId" TEXT NOT NULL,
    "linearTeamId" TEXT NOT NULL,

    CONSTRAINT "synced_issues_pkey" PRIMARY KEY ("id")
);
