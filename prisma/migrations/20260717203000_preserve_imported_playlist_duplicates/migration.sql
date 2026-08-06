-- DropIndex
DROP INDEX IF EXISTS "ImportedTrack_importedPlaylistId_normalizedKey_key";

-- CreateIndex
CREATE INDEX "ImportedTrack_importedPlaylistId_normalizedKey_idx" ON "ImportedTrack"("importedPlaylistId", "normalizedKey");
