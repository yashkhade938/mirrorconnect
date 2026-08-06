-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchResult" (
    "id" TEXT NOT NULL,
    "searchQueryId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,
    "duration" TEXT,
    "publishedAt" TIMESTAMP(3),
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchQuery_normalizedQuery_key" ON "SearchQuery"("normalizedQuery");

-- CreateIndex
CREATE INDEX "SearchQuery_normalizedQuery_idx" ON "SearchQuery"("normalizedQuery");

-- CreateIndex
CREATE INDEX "SearchQuery_searchCount_idx" ON "SearchQuery"("searchCount");

-- CreateIndex
CREATE INDEX "SearchQuery_cachedAt_idx" ON "SearchQuery"("cachedAt");

-- CreateIndex
CREATE INDEX "SearchResult_videoId_idx" ON "SearchResult"("videoId");

-- CreateIndex
CREATE INDEX "SearchResult_searchQueryId_position_idx" ON "SearchResult"("searchQueryId", "position");

-- CreateIndex
CREATE INDEX "SearchResult_title_idx" ON "SearchResult"("title");

-- CreateIndex
CREATE INDEX "SearchResult_channelName_idx" ON "SearchResult"("channelName");

-- CreateIndex
CREATE INDEX "SearchResult_cachedAt_idx" ON "SearchResult"("cachedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchResult_searchQueryId_videoId_key" ON "SearchResult"("searchQueryId", "videoId");

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_searchQueryId_fkey" FOREIGN KEY ("searchQueryId") REFERENCES "SearchQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
