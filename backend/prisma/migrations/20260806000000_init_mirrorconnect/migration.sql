CREATE TYPE "SessionStatus" AS ENUM ('waiting', 'connecting', 'connected', 'disconnected', 'expired');

CREATE TABLE "MirrorSession" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'waiting',
  "tokenHash" TEXT NOT NULL,
  "deviceName" TEXT,
  "viewerSocketId" TEXT,
  "deviceSocketId" TEXT,
  "connectedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MirrorSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MirrorSession_sessionId_key" ON "MirrorSession"("sessionId");
CREATE INDEX "MirrorSession_status_idx" ON "MirrorSession"("status");
CREATE INDEX "MirrorSession_expiresAt_idx" ON "MirrorSession"("expiresAt");
CREATE INDEX "MirrorSession_lastActivityAt_idx" ON "MirrorSession"("lastActivityAt");
CREATE INDEX "SessionEvent_sessionId_createdAt_idx" ON "SessionEvent"("sessionId", "createdAt");

ALTER TABLE "SessionEvent"
ADD CONSTRAINT "SessionEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "MirrorSession"("sessionId")
ON DELETE CASCADE ON UPDATE CASCADE;
