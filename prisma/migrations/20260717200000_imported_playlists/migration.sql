-- CreateTable
CREATE TABLE "ImportedPlaylist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedTrack" (
    "id" TEXT NOT NULL,
    "importedPlaylistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "artworkUrl" TEXT,
    "position" INTEGER NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "matchedYoutubeVideoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportedPlaylist_sourceUrl_key" ON "ImportedPlaylist"("sourceUrl");

-- CreateIndex
CREATE INDEX "ImportedPlaylist_source_idx" ON "ImportedPlaylist"("source");

-- CreateIndex
CREATE INDEX "ImportedPlaylist_updatedAt_idx" ON "ImportedPlaylist"("updatedAt");

-- CreateIndex
CREATE INDEX "ImportedTrack_title_idx" ON "ImportedTrack"("title");

-- CreateIndex
CREATE INDEX "ImportedTrack_artist_idx" ON "ImportedTrack"("artist");

-- CreateIndex
CREATE INDEX "ImportedTrack_matchedYoutubeVideoId_idx" ON "ImportedTrack"("matchedYoutubeVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTrack_importedPlaylistId_normalizedKey_key" ON "ImportedTrack"("importedPlaylistId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTrack_importedPlaylistId_position_key" ON "ImportedTrack"("importedPlaylistId", "position");

-- AddForeignKey
ALTER TABLE "ImportedTrack" ADD CONSTRAINT "ImportedTrack_importedPlaylistId_fkey" FOREIGN KEY ("importedPlaylistId") REFERENCES "ImportedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
