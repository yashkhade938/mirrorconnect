import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { snapshotFromDb, snapshotToDb, type TrackSnapshotInput } from "@/lib/track-snapshot";

export async function GET() {
  await ensureDatabase();
  const user = await requireSessionUser();
  const likes = await prisma.like.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json({
    likes: likes.map(snapshotFromDb),
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const body = (await request.json()) as { track?: TrackSnapshotInput };

  if (!body.track?.videoId) {
    return NextResponse.json({ error: "Missing track." }, { status: 400 });
  }

  const existing = await prisma.like.findUnique({
    where: {
      userId_youtubeVideoId: {
        userId: user.id,
        youtubeVideoId: body.track.videoId,
      },
    },
  });

  if (existing) {
    await prisma.like.delete({
      where: {
        id: existing.id,
      },
    });

    return NextResponse.json({
      liked: false,
    });
  }

  await prisma.like.create({
    data: {
      userId: user.id,
      ...snapshotToDb(body.track),
    },
  });

  return NextResponse.json({
    liked: true,
  });
}
