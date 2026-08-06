-- CreateTable
CREATE TABLE "YouTubeApiUsage" (
    "day" TEXT NOT NULL,
    "searchCalls" INTEGER NOT NULL DEFAULT 0,
    "videoCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeApiUsage_pkey" PRIMARY KEY ("day")
);
