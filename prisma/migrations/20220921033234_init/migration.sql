-- CreateTable
CREATE TABLE "synced_issues" (
    "id" TEXT NOT NULL,
    "githubIssueNumber" INTEGER NOT NULL,
    "linearIssueNumber" INTEGER NOT NULL,
    "githubIssueId" INTEGER NOT NULL,
    "linearIssueId" TEXT NOT NULL,
    "linearTeamId" TEXT NOT NULL,
    "githubRepoId" INTEGER NOT NULL,

    CONSTRAINT "synced_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linear_teams" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "publicLabelId" TEXT NOT NULL,
    "canceledStateId" TEXT NOT NULL,
    "doneStateId" TEXT NOT NULL,
    "toDoStateId" TEXT NOT NULL,

    CONSTRAINT "linear_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repos" (
    "id" TEXT NOT NULL,
    "repoId" INTEGER NOT NULL,
    "repoName" TEXT NOT NULL,

    CONSTRAINT "github_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syncs" (
    "id" TEXT NOT NULL,
    "githubUserId" INTEGER NOT NULL,
    "linearUserId" TEXT NOT NULL,
    "githubRepoId" INTEGER NOT NULL,
    "githubWebhookSecret" TEXT NOT NULL,
    "githubApiKey" TEXT NOT NULL,
    "githubApiKeyIV" TEXT NOT NULL,
    "linearTeamId" TEXT NOT NULL,
    "linearApiKey" TEXT NOT NULL,
    "linearApiKeyIV" TEXT NOT NULL,

    CONSTRAINT "syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "linear_teams_teamId_key" ON "linear_teams"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "github_repos_repoId_key" ON "github_repos"("repoId");

-- AddForeignKey
ALTER TABLE "synced_issues" ADD CONSTRAINT "synced_issues_linearTeamId_fkey" FOREIGN KEY ("linearTeamId") REFERENCES "linear_teams"("teamId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synced_issues" ADD CONSTRAINT "synced_issues_githubRepoId_fkey" FOREIGN KEY ("githubRepoId") REFERENCES "github_repos"("repoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syncs" ADD CONSTRAINT "syncs_linearTeamId_fkey" FOREIGN KEY ("linearTeamId") REFERENCES "linear_teams"("teamId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syncs" ADD CONSTRAINT "syncs_githubRepoId_fkey" FOREIGN KEY ("githubRepoId") REFERENCES "github_repos"("repoId") ON DELETE RESTRICT ON UPDATE CASCADE;
