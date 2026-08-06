import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ playlistId: string; videoId: string }> },
) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const { playlistId, videoId } = await params;
  const playlist = await prisma.playlist.findFirst({
    where: {
      id: playlistId,
      userId: user.id,
    },
  });

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  await prisma.playlistTrack.deleteMany({
    where: {
      playlistId,
      youtubeVideoId: videoId,
    },
  });

  return NextResponse.json({
    ok: true,
  });
}
