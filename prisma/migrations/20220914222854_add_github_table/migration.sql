-- CreateTable
CREATE TABLE "github_repos" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,

    CONSTRAINT "github_repos_pkey" PRIMARY KEY ("id")
);
