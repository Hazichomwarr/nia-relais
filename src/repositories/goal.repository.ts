import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

export function createPersonalGoalRecord(input: {
  ownerId: string;
  name: string;
  currency: string;
  targetAmount: Prisma.Decimal;
  weeklyAmount: Prisma.Decimal;
  startDate: Date;
  unlockDate: Date;
}) {
  return prisma.personalGoal.create({
    data: {
      ownerId: input.ownerId,
      name: input.name,
      currency: input.currency,
      targetAmount: input.targetAmount,
      weeklyAmount: input.weeklyAmount,
      startDate: input.startDate,
      unlockDate: input.unlockDate,
      status: "ACTIVE",
      completedAt: null,
      archivedAt: null,
    },
    select: {
      id: true,
      ownerId: true,
      name: true,
      currency: true,
      targetAmount: true,
      weeklyAmount: true,
      startDate: true,
      unlockDate: true,
      status: true,
      createdAt: true,
    },
  });
}
