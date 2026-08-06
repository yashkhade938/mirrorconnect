import type { SearchResult } from "@prisma/client";
import type { YouTubeTrack } from "@/lib/youtube";

export function youtubeTrackFromSearchResult(result: SearchResult): YouTubeTrack {
  return {
    videoId: result.videoId,
    title: result.title,
    rawTitle: result.rawTitle,
    artist: result.artist,
    channelTitle: result.channelName,
    thumbnail: result.thumbnail,
    publishedAt: result.publishedAt?.toISOString() ?? result.cachedAt.toISOString(),
    duration: result.duration ?? undefined,
    description: result.description ?? undefined,
    cachedAt: result.cachedAt.toISOString(),
  };
}
