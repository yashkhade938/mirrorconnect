import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "mixtape_user";
const DEV_USER_EMAIL = "demo@mixtape.local";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  // Auth cutover point: replace this cookie lookup with NextAuth getServerSession
  // when Google/email OAuth is enabled for deployment.
  const cookieStore = await cookies();
  const userId = cookieStore.get(SESSION_COOKIE)?.value;

  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
    },
  });
}

export async function requireSessionUser() {
  const user = await getSessionUser();

  if (!user) {
    throw new Response("Authentication required.", { status: 401 });
  }

  return user;
}

export async function createDemoSession() {
  const user = await prisma.user.upsert({
    where: {
      email: DEV_USER_EMAIL,
    },
    update: {},
    create: {
      email: DEV_USER_EMAIL,
      name: "Mixtape Demo",
    },
  });

  return user;
}
