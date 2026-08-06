import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { snapshotFromDb, snapshotToDb, type TrackSnapshotInput } from "@/lib/track-snapshot";

export async function GET() {
  await ensureDatabase();
  const user = await requireSessionUser();
  const history = await prisma.playHistory.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      playedAt: "desc",
    },
    take: 20,
  });

  return NextResponse.json({
    history: history.map(snapshotFromDb),
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const body = (await request.json()) as { track?: TrackSnapshotInput };

  if (!body.track?.videoId) {
    return NextResponse.json({ error: "Missing track." }, { status: 400 });
  }

  await prisma.playHistory.create({
    data: {
      userId: user.id,
      ...snapshotToDb(body.track),
    },
  });

  return NextResponse.json({
    ok: true,
  });
}
