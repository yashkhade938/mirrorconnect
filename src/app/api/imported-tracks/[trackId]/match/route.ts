import { NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import type { YouTubeTrack } from "@/lib/youtube";
import { youtubeTrackFromSearchResult } from "@/lib/youtube-track-db";

export const runtime = "nodejs";

async function findMatchedTrack(trackId: string) {
  const importedTrack = await prisma.importedTrack.findUnique({
    where: {
      id: trackId,
    },
  });

  if (!importedTrack) {
    return {
      error: NextResponse.json({ error: "Imported track not found." }, { status: 404 }),
    };
  }

  if (!importedTrack.matchedYoutubeVideoId) {
    return {
      importedTrack,
      track: null,
    };
  }

  const searchResult = await prisma.searchResult.findFirst({
    where: {
      videoId: importedTrack.matchedYoutubeVideoId,
    },
  });

  return {
    importedTrack,
    track: searchResult ? youtubeTrackFromSearchResult(searchResult) : null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  await ensureDatabase();
  const { trackId } = await params;
  const result = await findMatchedTrack(trackId);

  if (result.error) {
    return result.error;
  }

  if (!result.track) {
    return NextResponse.json(
      {
        error: "This imported song is not matched to YouTube yet.",
        importedTrack: result.importedTrack,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    track: result.track,
    importedTrack: result.importedTrack,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  await ensureDatabase();
  const { trackId } = await params;
  const body = (await request.json()) as { youtubeVideoId?: string; track?: YouTubeTrack };
  const youtubeVideoId = body.youtubeVideoId ?? body.track?.videoId;

  if (!youtubeVideoId) {
    return NextResponse.json({ error: "Missing YouTube video ID." }, { status: 400 });
  }

  const importedTrack = await prisma.importedTrack.update({
    where: {
      id: trackId,
    },
    data: {
      matchedYoutubeVideoId: youtubeVideoId,
    },
  });
  const searchResult = await prisma.searchResult.findFirst({
    where: {
      videoId: youtubeVideoId,
    },
  });

  return NextResponse.json({
    importedTrack,
    track: searchResult ? youtubeTrackFromSearchResult(searchResult) : body.track ?? null,
  });
}
