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

-- CreateTable
CREATE TABLE "linear_labels" (
    "id" TEXT NOT NULL,
    "publicLabelId" TEXT NOT NULL,
    "canceledStateId" TEXT NOT NULL,
    "doneStateId" TEXT NOT NULL,
    "toDoStateId" TEXT NOT NULL,
    "inProgressStateId" TEXT NOT NULL,

    CONSTRAINT "linear_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repos" (
    "id" TEXT NOT NULL,
    "repoId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,

    CONSTRAINT "github_repos_pkey" PRIMARY KEY ("id")
);
