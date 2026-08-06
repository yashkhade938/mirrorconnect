import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ playlistId: string }> },
) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const { playlistId } = await params;
  const body = (await request.json()) as { name?: string; description?: string };

  await prisma.playlist.updateMany({
    where: {
      id: playlistId,
      userId: user.id,
    },
    data: {
      name: body.name?.trim() || undefined,
      description: body.description?.trim() || null,
    },
  });
  const playlist = await prisma.playlist.findFirst({
    where: {
      id: playlistId,
      userId: user.id,
    },
  });

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  return NextResponse.json({
    playlist,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ playlistId: string }> },
) {
  await ensureDatabase();
  const user = await requireSessionUser();
  const { playlistId } = await params;

  const result = await prisma.playlist.deleteMany({
    where: {
      id: playlistId,
      userId: user.id,
    },
  });

  if (!result.count) {
    return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
  });
}
