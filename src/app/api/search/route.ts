import { NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeSearchText } from "@/lib/search-normalize";
import { cleanTitle, inferArtist, type YouTubeTrack } from "@/lib/youtube";
import { youtubeTrackFromSearchResult } from "@/lib/youtube-track-db";

export const runtime = "nodejs";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DEFAULT_DAILY_SEARCH_LIMIT = 25;

type YouTubeSearchItem = {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type YouTubeVideoItem = {
  id?: string;
  contentDetails?: {
    duration?: string;
  };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type CachedSearchQuery = Awaited<ReturnType<typeof getCachedSearch>>;

function normalizeQuery(query: string) {
  return normalizeSearchText(query);
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? String(fallback));

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function parseDailySearchLimit() {
  const parsed = Number(process.env.YOUTUBE_DAILY_SEARCH_LIMIT ?? DEFAULT_DAILY_SEARCH_LIMIT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DAILY_SEARCH_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function getUsageDay() {
  return new Date().toISOString().slice(0, 10);
}

function getSearchTerms(normalizedQuery: string) {
  return normalizedQuery
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 4);
}

function formatIsoDuration(duration: string | undefined) {
  if (!duration) {
    return undefined;
  }

  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);

  if (!match) {
    return duration;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function thumbnailFor(videoId: string, item?: YouTubeSearchItem | YouTubeVideoItem) {
  return (
    item?.snippet?.thumbnails?.high?.url ??
    item?.snippet?.thumbnails?.medium?.url ??
    item?.snippet?.thumbnails?.default?.url ??
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  );
}

function mapSearchItem(item: YouTubeSearchItem, videoDetails?: YouTubeVideoItem): YouTubeTrack | null {
  const videoId = item.id?.videoId;
  const snippet = videoDetails?.snippet ?? item.snippet;
  const rawTitle = snippet?.title ?? item.snippet?.title;

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
    thumbnail: thumbnailFor(videoId, videoDetails ?? item),
    publishedAt: snippet.publishedAt ?? new Date().toISOString(),
    duration: formatIsoDuration(videoDetails?.contentDetails?.duration),
    description: snippet.description ?? item.snippet?.description ?? "",
  };
}

function mapCachedResult(
  result: NonNullable<CachedSearchQuery>["results"][number],
): YouTubeTrack {
  return youtubeTrackFromSearchResult(result);
}

function isFresh(cachedAt: Date) {
  return Date.now() - cachedAt.getTime() < CACHE_TTL_MS;
}

function isYouTubeQuotaError(details: string) {
  return (
    details.includes("quotaExceeded") ||
    details.includes("rateLimitExceeded") ||
    details.includes("RESOURCE_EXHAUSTED") ||
    details.includes("Search Queries per day")
  );
}

function logSearch(event: string, metadata: Record<string, unknown>) {
  console.info(`[search] ${event}`, metadata);
}

async function getCachedSearch(normalizedQuery: string, page: number, pageSize: number) {
  const cached = await prisma.searchQuery.findUnique({
    where: {
      normalizedQuery,
    },
    include: {
      results: {
        orderBy: {
          position: "asc",
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      },
    },
  });

  if (!cached) {
    return null;
  }

  const total = await prisma.searchResult.count({
    where: {
      searchQueryId: cached.id,
    },
  });

  return {
    ...cached,
    total,
  };
}

async function incrementSearchCount(searchQueryId: string) {
  await prisma.searchQuery.update({
    where: {
      id: searchQueryId,
    },
    data: {
      searchCount: {
        increment: 1,
      },
    },
  });
}

async function reserveYouTubeSearchCall() {
  const day = getUsageDay();
  const dailyLimit = parseDailySearchLimit();
  const usage = await prisma.youTubeApiUsage.findUnique({
    where: {
      day,
    },
  });

  if (usage && usage.searchCalls >= dailyLimit) {
    return {
      allowed: false,
      day,
      dailyLimit,
      searchCalls: usage.searchCalls,
    };
  }

  const updated = await prisma.youTubeApiUsage.upsert({
    where: {
      day,
    },
    create: {
      day,
      searchCalls: 1,
    },
    update: {
      searchCalls: {
        increment: 1,
      },
    },
  });

  return {
    allowed: true,
    day,
    dailyLimit,
    searchCalls: updated.searchCalls,
  };
}

async function recordVideoListCall() {
  await prisma.youTubeApiUsage.upsert({
    where: {
      day: getUsageDay(),
    },
    create: {
      day: getUsageDay(),
      videoCalls: 1,
    },
    update: {
      videoCalls: {
        increment: 1,
      },
    },
  });
}

async function migrateLegacyCache(normalizedQuery: string, maxResults: number) {
  const legacy =
    (await prisma.searchCache.findUnique({
      where: {
        query_maxResults: {
          query: normalizedQuery,
          maxResults,
        },
      },
    })) ??
    (await prisma.searchCache.findFirst({
      where: {
        query: normalizedQuery,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }));

  if (!legacy) {
    return null;
  }

  const results = JSON.parse(legacy.results) as YouTubeTrack[];
  const saved = await saveSearchResults(normalizedQuery, normalizedQuery, results, legacy.updatedAt);
  logSearch("CACHE SAVED", {
    query: normalizedQuery,
    source: "legacy-json",
    count: results.length,
  });

  return saved;
}

async function getPartialCachedResults(normalizedQuery: string, page: number, pageSize: number) {
  const searchableValues = Array.from(new Set([normalizedQuery, ...getSearchTerms(normalizedQuery)]));
  const textMatchers = searchableValues.flatMap((value) => [
    {
      title: {
        contains: value,
        mode: "insensitive" as const,
      },
    },
    {
      rawTitle: {
        contains: value,
        mode: "insensitive" as const,
      },
    },
    {
      artist: {
        contains: value,
        mode: "insensitive" as const,
      },
    },
    {
      channelName: {
        contains: value,
        mode: "insensitive" as const,
      },
    },
    {
      searchQuery: {
        normalizedQuery: {
          contains: value,
          mode: "insensitive" as const,
        },
      },
    },
  ]);

  const results = await prisma.searchResult.findMany({
    where: {
      OR: textMatchers,
    },
    orderBy: [
      {
        cachedAt: "desc",
      },
      {
        position: "asc",
      },
    ],
    distinct: ["videoId"],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return results.map(mapCachedResult);
}

async function getImportedMatchedResults(normalizedQuery: string, page: number, pageSize: number) {
  const searchableValues = Array.from(new Set([normalizedQuery, ...getSearchTerms(normalizedQuery)]));
  const importedMatches = await prisma.importedTrack.findMany({
    where: {
      matchedYoutubeVideoId: {
        not: null,
      },
      OR: searchableValues.flatMap((value) => [
        {
          title: {
            contains: value,
            mode: "insensitive" as const,
          },
        },
        {
          artist: {
            contains: value,
            mode: "insensitive" as const,
          },
        },
      ]),
    },
    orderBy: {
      position: "asc",
    },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      matchedYoutubeVideoId: true,
    },
  });
  const videoIds = importedMatches
    .map((track) => track.matchedYoutubeVideoId)
    .filter((videoId): videoId is string => Boolean(videoId));

  if (!videoIds.length) {
    return [];
  }

  const results = await prisma.searchResult.findMany({
    where: {
      videoId: {
        in: videoIds,
      },
    },
    distinct: ["videoId"],
  });
  const byVideoId = new Map(results.map((result) => [result.videoId, result]));

  return videoIds
    .map((videoId) => byVideoId.get(videoId))
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .map(youtubeTrackFromSearchResult);
}

async function saveSearchResults(
  displayQuery: string,
  normalizedQuery: string,
  results: YouTubeTrack[],
  cachedAt = new Date(),
) {
  const searchQuery = await prisma.searchQuery.upsert({
    where: {
      normalizedQuery,
    },
    create: {
      query: displayQuery,
      normalizedQuery,
      cachedAt,
      refreshedAt: cachedAt,
    },
    update: {
      query: displayQuery,
      cachedAt,
      refreshedAt: cachedAt,
    },
  });

  await prisma.$transaction(
    results.map((track, position) =>
      prisma.searchResult.upsert({
        where: {
          searchQueryId_videoId: {
            searchQueryId: searchQuery.id,
            videoId: track.videoId,
          },
        },
        create: {
          searchQueryId: searchQuery.id,
          videoId: track.videoId,
          title: track.title,
          rawTitle: track.rawTitle,
          artist: track.artist,
          channelName: track.channelTitle,
          thumbnail: track.thumbnail,
          duration: track.duration,
          publishedAt: track.publishedAt ? new Date(track.publishedAt) : undefined,
          description: track.description,
          position,
          cachedAt,
        },
        update: {
          title: track.title,
          rawTitle: track.rawTitle,
          artist: track.artist,
          channelName: track.channelTitle,
          thumbnail: track.thumbnail,
          duration: track.duration,
          publishedAt: track.publishedAt ? new Date(track.publishedAt) : undefined,
          description: track.description,
          position,
          cachedAt,
        },
      }),
    ),
  );

  return searchQuery;
}

async function fetchVideoDetails(videoIds: string[], apiKey: string) {
  if (!videoIds.length) {
    return new Map<string, YouTubeVideoItem>();
  }

  const url = new URL(YOUTUBE_VIDEOS_URL);
  url.searchParams.set("part", "contentDetails,snippet");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", apiKey);

  logSearch("API CALL", {
    endpoint: "videos.list",
    count: videoIds.length,
  });
  await recordVideoListCall();

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details);
  }

  const payload = (await response.json()) as { items?: YouTubeVideoItem[] };
  return new Map((payload.items ?? []).filter((item) => item.id).map((item) => [item.id as string, item]));
}

async function fetchYouTubeResults(query: string, maxResults: number, apiKey: string) {
  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("safeSearch", "none");

  logSearch("API CALL", {
    endpoint: "search.list",
    query,
    maxResults,
  });

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details);
  }

  const payload = (await response.json()) as { items?: YouTubeSearchItem[] };
  const items = payload.items ?? [];
  const videoIds = items.map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
  const details = await fetchVideoDetails(videoIds, apiKey);

  return items
    .map((item) => mapSearchItem(item, item.id?.videoId ? details.get(item.id.videoId) : undefined))
    .filter((item): item is YouTubeTrack => Boolean(item));
}

function cachedResponse(
  query: string,
  normalizedQuery: string,
  cached: NonNullable<CachedSearchQuery>,
  page: number,
  pageSize: number,
  stale = false,
) {
  return NextResponse.json({
    query,
    normalizedQuery,
    cached: true,
    stale,
    source: "database",
    page,
    pageSize,
    total: cached.total,
    results: cached.results.map(mapCachedResult),
  });
}

function partialCachedResponse(
  query: string,
  normalizedQuery: string,
  results: YouTubeTrack[],
  page: number,
  pageSize: number,
) {
  return NextResponse.json({
    query,
    normalizedQuery,
    cached: true,
    stale: true,
    source: "database-partial",
    page,
    pageSize,
    total: results.length,
    results,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q") ?? "";
  const query = rawQuery.replace(/\s+/g, " ").trim();
  const normalizedQuery = normalizeQuery(rawQuery);
  const forceYouTube = searchParams.get("refresh") === "true" || searchParams.get("source") === "youtube";
  const page = parsePositiveInt(searchParams.get("page"), 1, 100);
  const pageSize = parsePositiveInt(
    searchParams.get("pageSize") ?? searchParams.get("maxResults"),
    12,
    25,
  );
  const maxResults = Math.max(pageSize, parsePositiveInt(searchParams.get("maxResults"), 12, 25));

  if (!normalizedQuery) {
    return NextResponse.json(
      { error: "Missing search query. Pass ?q=artist or song." },
      { status: 400 },
    );
  }

  await ensureDatabase();

  let cached = await getCachedSearch(normalizedQuery, page, pageSize);

  if (!cached) {
    const legacySearch = await migrateLegacyCache(normalizedQuery, maxResults);

    if (legacySearch) {
      cached = await getCachedSearch(normalizedQuery, page, pageSize);
    }
  }

  if (cached && isFresh(cached.cachedAt)) {
    logSearch("CACHE HIT", {
      query: normalizedQuery,
      count: cached.results.length,
    });
    await incrementSearchCount(cached.id);
    return cachedResponse(query || cached.query, normalizedQuery, cached, page, pageSize);
  }

  logSearch("CACHE MISS", {
    query: normalizedQuery,
    reason: cached ? "expired" : "not_found",
  });

  const partialResults = await getPartialCachedResults(normalizedQuery, page, pageSize);
  const importedMatchedResults = await getImportedMatchedResults(normalizedQuery, page, pageSize);

  if (!forceYouTube && importedMatchedResults.length) {
    logSearch("CACHE HIT", {
      query: normalizedQuery,
      imported: true,
      reason: "imported_matched_results",
      count: importedMatchedResults.length,
    });
    return partialCachedResponse(query || normalizedQuery, normalizedQuery, importedMatchedResults, page, pageSize);
  }

  if (!forceYouTube && partialResults.length) {
    logSearch("CACHE HIT", {
      query: normalizedQuery,
      partial: true,
      reason: "related_local_results",
      count: partialResults.length,
    });
    return partialCachedResponse(query || normalizedQuery, normalizedQuery, partialResults, page, pageSize);
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local";
  const limit = rateLimit(`search:${ip}`, 30, 60 * 1000);

  if (!limit.allowed) {
    if (cached) {
      logSearch("CACHE HIT", {
        query: normalizedQuery,
        stale: true,
        reason: "rate_limited",
      });
      await incrementSearchCount(cached.id);
      return cachedResponse(query || cached.query, normalizedQuery, cached, page, pageSize, true);
    }

    if (partialResults.length) {
      logSearch("CACHE HIT", {
        query: normalizedQuery,
        partial: true,
        reason: "rate_limited",
        count: partialResults.length,
      });
      return partialCachedResponse(query || normalizedQuery, normalizedQuery, partialResults, page, pageSize);
    }

    return NextResponse.json(
      {
        error: "Too many new searches. Cached searches still work, so try a previous search or wait a moment.",
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
        },
      },
    );
  }

  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    if (cached) {
      await incrementSearchCount(cached.id);
      return cachedResponse(query || cached.query, normalizedQuery, cached, page, pageSize, true);
    }

    if (partialResults.length) {
      logSearch("CACHE HIT", {
        query: normalizedQuery,
        partial: true,
        reason: "missing_api_key",
        count: partialResults.length,
      });
      return partialCachedResponse(query || normalizedQuery, normalizedQuery, partialResults, page, pageSize);
    }

    return NextResponse.json(
      {
        error:
          "YOUTUBE_API_KEY is not configured. Add it to .env after enabling YouTube Data API v3 in Google Cloud.",
      },
      { status: 500 },
    );
  }

  try {
    const usage = await reserveYouTubeSearchCall();

    if (!usage.allowed) {
      logSearch("CACHE MISS", {
        query: normalizedQuery,
        reason: "daily_youtube_guard",
        searchCalls: usage.searchCalls,
        dailyLimit: usage.dailyLimit,
      });

      return NextResponse.json(
        {
          error:
            "Daily YouTube search protection is on. Cached searches still work, and new YouTube searches will resume tomorrow.",
          quotaProtected: true,
          dailyLimit: usage.dailyLimit,
          searchCalls: usage.searchCalls,
        },
        { status: 429 },
      );
    }

    const results = await fetchYouTubeResults(normalizedQuery, maxResults, apiKey);
    const saved = await saveSearchResults(query || normalizedQuery, normalizedQuery, results);

    if (cached) {
      logSearch("CACHE UPDATED", {
        query: normalizedQuery,
        count: results.length,
      });
    } else {
      logSearch("CACHE SAVED", {
        query: normalizedQuery,
        count: results.length,
      });
    }

    return NextResponse.json({
      query: query || normalizedQuery,
      normalizedQuery,
      cached: false,
      source: "youtube",
      page,
      pageSize,
      total: results.length,
      results,
      searchQueryId: saved.id,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "YouTube search failed.";
    const quotaExceeded = isYouTubeQuotaError(details);

    if (cached) {
      logSearch("CACHE HIT", {
        query: normalizedQuery,
        stale: true,
        reason: "youtube_error",
      });
      await incrementSearchCount(cached.id);
      return cachedResponse(query || cached.query, normalizedQuery, cached, page, pageSize, true);
    }

    if (partialResults.length) {
      logSearch("CACHE HIT", {
        query: normalizedQuery,
        partial: true,
        reason: "youtube_error",
        count: partialResults.length,
      });
      return partialCachedResponse(query || normalizedQuery, normalizedQuery, partialResults, page, pageSize);
    }

    return NextResponse.json(
      {
        error: quotaExceeded
          ? "YouTube search quota is exhausted for today. Cached searches still work, but this search has not been cached yet."
          : "YouTube search failed. Please try again in a moment.",
        quotaExceeded,
        details,
      },
      { status: quotaExceeded ? 429 : 502 },
    );
  }
}
