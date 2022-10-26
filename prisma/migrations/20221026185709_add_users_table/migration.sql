-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "githubUserId" INTEGER NOT NULL,
    "githubUsername" TEXT NOT NULL,
    "githubEmail" TEXT,
    "linearUserId" TEXT NOT NULL,
    "linearUsername" TEXT NOT NULL,
    "linearEmail" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_githubUserId_linearUserId_key" ON "users"("githubUserId", "linearUserId");
