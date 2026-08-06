import { NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { normalizeSearchText } from "@/lib/search-normalize";

export const runtime = "nodejs";

function normalizeQuery(query: string) {
  return normalizeSearchText(query);
}

function parseTake(value: string | null) {
  const parsed = Number(value ?? "8");

  if (!Number.isFinite(parsed)) {
    return 8;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = normalizeQuery(searchParams.get("q") ?? "");
  const take = parseTake(searchParams.get("take"));

  if (!query) {
    return NextResponse.json({ suggestions: [] });
  }

  await ensureDatabase();

  const [cachedSuggestions, importedSuggestions] = await Promise.all([
    prisma.searchQuery.findMany({
      where: {
        normalizedQuery: {
          contains: query,
          mode: "insensitive",
        },
      },
      orderBy: [
        {
          searchCount: "desc",
        },
        {
          updatedAt: "desc",
        },
      ],
      take,
      select: {
        query: true,
        normalizedQuery: true,
        searchCount: true,
      },
    }),
    prisma.importedTrack.findMany({
      where: {
        OR: [
          {
            title: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            artist: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            normalizedKey: {
              contains: query,
              mode: "insensitive",
            },
          },
        ],
      },
      orderBy: {
        position: "asc",
      },
      take,
      select: {
        title: true,
        artist: true,
      },
    }),
  ]);
  const suggestions = [
    ...cachedSuggestions,
    ...importedSuggestions.map((track) => {
      const suggestion = `${track.title} ${track.artist}`;

      return {
        query: suggestion,
        normalizedQuery: normalizeSearchText(suggestion),
        searchCount: 0,
      };
    }),
  ].slice(0, take);

  return NextResponse.json({ suggestions });
}
