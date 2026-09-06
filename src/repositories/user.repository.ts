import { prisma } from "@/src/prisma";

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
}

export function createUser(input: { name: string; email: string; passwordHash: string }) {
  return prisma.user.create({
    data: input,
    select: { id: true, name: true, email: true },
  });
}
