import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { snapshotToDb, type TrackSnapshotInput } from "@/lib/track-snapshot";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ playlistId: string }> },
) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const { playlistId } = await params;
  const body = (await request.json()) as { track?: TrackSnapshotInput };

  if (!body.track?.videoId) {
    return NextResponse.json({ error: "Missing track." }, { status: 400 });
  }

  const playlist = await prisma.playlist.findFirst({
    where: {
      id: playlistId,
      userId: user.id,
    },
    include: {
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  const track = await prisma.playlistTrack.upsert({
    where: {
      playlistId_youtubeVideoId: {
        playlistId,
        youtubeVideoId: body.track.videoId,
      },
    },
    update: snapshotToDb(body.track),
    create: {
      playlistId,
      position: playlist._count.tracks,
      ...snapshotToDb(body.track),
    },
  });

  return NextResponse.json({
    track,
  });
}
