import { NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function parseTake(value: string | null) {
  const parsed = Number(value ?? "40");

  if (!Number.isFinite(parsed)) {
    return 40;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const take = parseTake(searchParams.get("take"));

  await ensureDatabase();

  const playlists = await prisma.importedPlaylist.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      tracks: {
        orderBy: {
          position: "asc",
        },
        take,
      },
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  return NextResponse.json({
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      source: playlist.source,
      sourceUrl: playlist.sourceUrl,
      totalTracks: playlist._count.tracks,
      tracks: playlist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        artworkUrl: track.artworkUrl,
        position: track.position,
        matchedYoutubeVideoId: track.matchedYoutubeVideoId,
      })),
    })),
  });
}
