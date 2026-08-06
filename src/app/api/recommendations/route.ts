import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { cleanTitle, inferArtist, type YouTubeTrack } from "@/lib/youtube";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const SAME_ARTIST_LIMIT = 4;

type YouTubeSearchItem = {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

function mapSearchItem(item: YouTubeSearchItem): YouTubeTrack | null {
  const videoId = item.id?.videoId;
  const snippet = item.snippet;
  const rawTitle = snippet?.title;

  if (!videoId || !snippet || !rawTitle) {
    return null;
  }

  const channelTitle = snippet.channelTitle ?? "YouTube";

  return {
    videoId,
    rawTitle,
    title: cleanTitle(rawTitle),
    artist: inferArtist(rawTitle, channelTitle),
    channelTitle,
    thumbnail:
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    publishedAt: snippet.publishedAt ?? new Date().toISOString(),
  };
}

async function searchYouTube({
  apiKey,
  query,
  relatedToVideoId,
  maxResults = 8,
}: {
  apiKey: string;
  query?: string;
  relatedToVideoId?: string;
  maxResults?: number;
}) {
  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("safeSearch", "none");

  if (relatedToVideoId) {
    url.searchParams.set("relatedToVideoId", relatedToVideoId);
  } else {
    url.searchParams.set("q", query ?? "new music");
    url.searchParams.set("videoCategoryId", "10");
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    throw new Response(await response.text(), {
      status: response.status,
    });
  }

  const payload = (await response.json()) as { items?: YouTubeSearchItem[] };

  return (payload.items ?? [])
    .map(mapSearchItem)
    .filter((item): item is YouTubeTrack => Boolean(item));
}

function deDupeRecommendations(results: YouTubeTrack[], currentVideoId: string | null) {
  const seen = new Set<string>();

  return results.filter((track) => {
    if (track.videoId === currentVideoId || seen.has(track.videoId)) {
      return false;
    }

    seen.add(track.videoId);
    return true;
  });
}

export async function GET(request: Request) {
  await ensureDatabase();
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId");
  const artist = searchParams.get("artist");
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY is not configured." },
      { status: 500 },
    );
  }

  let query = artist ? `${artist} music` : "new music";
  let reason = artist ? `Because you played ${artist}` : "Fresh music picks";
  const user = await getSessionUser();

  if (!artist && user) {
    const recent = await prisma.playHistory.findFirst({
      where: {
        userId: user.id,
      },
      orderBy: {
        playedAt: "desc",
      },
    });

    if (recent) {
      query = `${recent.artist} music`;
      reason = `Because you played ${recent.artist}`;
    }
  }

  try {
    const [relatedSettled, sameArtistSettled, historySettled, freshSettled] =
      await Promise.allSettled([
        videoId
          ? searchYouTube({
              apiKey,
              relatedToVideoId: videoId,
            })
          : Promise.resolve([]),
        artist
          ? searchYouTube({
              apiKey,
              query: `${artist} music`,
              maxResults: SAME_ARTIST_LIMIT,
            })
          : Promise.resolve([]),
        !artist && user
          ? searchYouTube({
              apiKey,
              query,
              maxResults: SAME_ARTIST_LIMIT,
            })
          : Promise.resolve([]),
        searchYouTube({
          apiKey,
          query: "new indie pop electronic r&b music",
          maxResults: 8,
        }),
      ]);
    const relatedResults = relatedSettled.status === "fulfilled" ? relatedSettled.value : [];
    const sameArtistResults =
      sameArtistSettled.status === "fulfilled" ? sameArtistSettled.value : [];
    const historyResults = historySettled.status === "fulfilled" ? historySettled.value : [];
    const freshResults = freshSettled.status === "fulfilled" ? freshSettled.value : [];
    const results = deDupeRecommendations(
      [...relatedResults, ...sameArtistResults, ...historyResults, ...freshResults],
      videoId,
    ).slice(0, 8);

    if (relatedResults.length) {
      reason = artist ? `Because you played ${artist}` : "Related to the current track";
    } else if (sameArtistResults.length) {
      reason = `More from ${artist}`;
    } else if (historyResults.length) {
      reason = "Based on your listening history";
    } else {
      reason = "Fresh music picks";
    }

    return NextResponse.json({
      reason,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Recommendation lookup failed.",
        details: error instanceof Response ? await error.text() : "Unknown recommendation error.",
      },
      { status: error instanceof Response ? error.status : 500 },
    );
  }
}
