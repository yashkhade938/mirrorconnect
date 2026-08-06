import { prisma } from "@/lib/prisma";

let bootstrapPromise: Promise<void> | null = null;

export async function ensureDatabase() {
  if (process.env.DATABASE_URL?.startsWith("postgres")) {
    return;
  }

  bootstrapPromise ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SearchCache" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "query" TEXT NOT NULL,
        "maxResults" INTEGER NOT NULL DEFAULT 12,
        "results" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "SearchCache_query_maxResults_key"
      ON "SearchCache" ("query", "maxResults");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "SearchCache_updatedAt_idx"
      ON "SearchCache" ("updatedAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "email" TEXT NOT NULL,
        "name" TEXT,
        "image" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User" ("email");`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Playlist" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Playlist_userId_idx" ON "Playlist" ("userId");`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlaylistTrack" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "playlistId" TEXT NOT NULL,
        "youtubeVideoId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "artist" TEXT NOT NULL,
        "channelTitle" TEXT NOT NULL,
        "thumbnail" TEXT NOT NULL,
        "rawTitle" TEXT NOT NULL,
        "position" INTEGER NOT NULL,
        "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_youtubeVideoId_key" ON "PlaylistTrack" ("playlistId", "youtubeVideoId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_position_idx" ON "PlaylistTrack" ("playlistId", "position");`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Like" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "youtubeVideoId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "artist" TEXT NOT NULL,
        "channelTitle" TEXT NOT NULL,
        "thumbnail" TEXT NOT NULL,
        "rawTitle" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Like_userId_youtubeVideoId_key" ON "Like" ("userId", "youtubeVideoId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Like_userId_createdAt_idx" ON "Like" ("userId", "createdAt");`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PlayHistory" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "youtubeVideoId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "artist" TEXT NOT NULL,
        "channelTitle" TEXT NOT NULL,
        "thumbnail" TEXT NOT NULL,
        "rawTitle" TEXT NOT NULL,
        "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PlayHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlayHistory_userId_playedAt_idx" ON "PlayHistory" ("userId", "playedAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlayHistory_userId_artist_idx" ON "PlayHistory" ("userId", "artist");`);
  })();

  return bootstrapPromise;
}
