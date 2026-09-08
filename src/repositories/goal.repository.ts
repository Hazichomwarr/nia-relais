import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

type GoalTransaction = Prisma.TransactionClient;

const lifecycleGoalSelect = {
  id: true,
  ownerId: true,
  targetAmount: true,
  unlockDate: true,
  status: true,
  completedAt: true,
  completedById: true,
  archivedAt: true,
  archivedById: true,
} satisfies Prisma.PersonalGoalSelect;

export type LifecycleGoalRecord = Prisma.PersonalGoalGetPayload<{
  select: typeof lifecycleGoalSelect;
}>;

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

export function findPersonalGoalsByOwnerId(ownerId: string) {
  return prisma.personalGoal.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      currency: true,
      targetAmount: true,
      weeklyAmount: true,
      startDate: true,
      unlockDate: true,
      status: true,
      completedAt: true,
      archivedAt: true,
      createdAt: true,
    },
  });
}

export function findGoalForLifecycle(
  transaction: GoalTransaction,
  goalId: string,
) {
  return transaction.personalGoal.findUnique({
    where: { id: goalId },
    select: lifecycleGoalSelect,
  });
}

export function completeActivePersonalGoal(
  transaction: GoalTransaction,
  input: {
    goalId: string;
    ownerId: string;
    completedAt: Date;
  },
) {
  return transaction.personalGoal.updateMany({
    where: { id: input.goalId, ownerId: input.ownerId, status: "ACTIVE" },
    data: {
      status: "COMPLETED",
      completedAt: input.completedAt,
      completedById: input.ownerId,
      archivedAt: null,
      archivedById: null,
    },
  });
}

export function archiveCompletedPersonalGoal(
  transaction: GoalTransaction,
  input: {
    goalId: string;
    ownerId: string;
    archivedAt: Date;
  },
) {
  return transaction.personalGoal.updateMany({
    where: { id: input.goalId, ownerId: input.ownerId, status: "COMPLETED" },
    data: {
      status: "ARCHIVED",
      archivedAt: input.archivedAt,
      archivedById: input.ownerId,
    },
  });
}
