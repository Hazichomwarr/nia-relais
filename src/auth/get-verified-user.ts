import "server-only";

import { auth } from "@/auth";
import { prisma } from "@/src/prisma";

export async function getVerifiedUser() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
}
