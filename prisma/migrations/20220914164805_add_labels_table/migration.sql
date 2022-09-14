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
