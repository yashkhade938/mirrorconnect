import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";
import { snapshotFromDb } from "@/lib/track-snapshot";

export async function GET() {
  await ensureDatabase();
  const user = await requireSessionUser();
  const playlists = await prisma.playlist.findMany({
    where: {
      userId: user.id,
    },
    include: {
      tracks: {
        orderBy: {
          position: "asc",
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return NextResponse.json({
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      tracks: playlist.tracks.map(snapshotFromDb),
    })),
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const body = (await request.json()) as { name?: string; description?: string };
  const name = body.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Missing playlist name." }, { status: 400 });
  }

  const playlist = await prisma.playlist.create({
    data: {
      userId: user.id,
      name,
      description: body.description?.trim() || null,
    },
  });

  return NextResponse.json({
    playlist,
  });
}
