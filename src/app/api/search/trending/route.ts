import { NextResponse } from "next/server";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function parseTake(value: string | null) {
  const parsed = Number(value ?? "8");

  if (!Number.isFinite(parsed)) {
    return 8;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const take = parseTake(searchParams.get("take"));

  await ensureDatabase();

  const searches = await prisma.searchQuery.findMany({
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
  });

  return NextResponse.json({ searches });
}
