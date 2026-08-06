import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-bootstrap";

export async function GET() {
  await ensureDatabase();

  return NextResponse.json({
    user: await getSessionUser(),
  });
}
