import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDemoSession, SESSION_COOKIE } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";

export async function POST() {
  await ensureDatabase();
  const user = await createDemoSession();
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({
    user,
  });
}
