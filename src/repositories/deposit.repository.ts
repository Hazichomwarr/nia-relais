import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

const depositSelect = {
  id: true,
  goalId: true,
  amount: true,
  depositDate: true,
  verificationMode: true,
  responsibleCustodianId: true,
  recordedById: true,
  clientOperationId: true,
  status: true,
  approvedAt: true,
  rejectedAt: true,
  note: true,
  createdAt: true,
} satisfies Prisma.DepositSelect;

const depositHistorySelect = {
  id: true,
  goalId: true,
  amount: true,
  depositDate: true,
  status: true,
  verificationMode: true,
  note: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
} satisfies Prisma.DepositSelect;

const depositDetailSelect = {
  id: true,
  goalId: true,
  amount: true,
  depositDate: true,
  status: true,
  verificationMode: true,
  note: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
  recordedBy: { select: { name: true } },
  responsibleCustodian: { select: { displayName: true } },
  approvedBy: { select: { name: true } },
  rejectedBy: { select: { name: true } },
} satisfies Prisma.DepositSelect;

export type DepositRecord = Prisma.DepositGetPayload<{
  select: typeof depositSelect;
}>;

export type DepositHistoryRecord = Prisma.DepositGetPayload<{
  select: typeof depositHistorySelect;
}>;

export type DepositDetailRecord = Prisma.DepositGetPayload<{
  select: typeof depositDetailSelect;
}>;

type DepositClient = Prisma.TransactionClient;

export function findPersonalGoalByIdAndOwnerId(goalId: string, ownerId: string) {
  return prisma.personalGoal.findFirst({
    where: { id: goalId, ownerId },
    select: {
      id: true,
      ownerId: true,
      name: true,
      status: true,
      weeklyAmount: true,
      startDate: true,
      unlockDate: true,
      currency: true,
    },
  });
}

export function findDepositCreationContext(
  transaction: DepositClient,
  goalId: string,
  ownerId: string,
) {
  return transaction.personalGoal.findFirst({
    where: { id: goalId, ownerId },
    select: {
      id: true,
      ownerId: true,
      status: true,
      startDate: true,
      unlockDate: true,
      currency: true,
      custodians: {
        where: { status: "ACTIVE" },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        take: 2,
        select: { id: true },
      },
    },
  });
}

export function createDepositRecord(
  transaction: DepositClient,
  input: {
    goalId: string;
    amount: Prisma.Decimal;
    depositDate: Date;
    recordedById: string;
    verificationMode: "OWNER" | "CUSTODIAN";
    responsibleCustodianId: string | null;
    clientOperationId: string;
    status: "PENDING" | "APPROVED";
    approvedById: string | null;
    approvedAt: Date | null;
    note: string | null;
  },
) {
  return transaction.deposit.create({
    data: {
      goalId: input.goalId,
      amount: input.amount,
      depositDate: input.depositDate,
      recordedById: input.recordedById,
      verificationMode: input.verificationMode,
      responsibleCustodianId: input.responsibleCustodianId,
      clientOperationId: input.clientOperationId,
      status: input.status,
      approvedById: input.approvedById,
      approvedAt: input.approvedAt,
      rejectedById: null,
      rejectedAt: null,
      rejectionReason: null,
      note: input.note,
    },
    select: depositSelect,
  });
}

export function findDepositByOperationId(
  goalId: string,
  clientOperationId: string,
) {
  return prisma.deposit.findUnique({
    where: {
      goalId_clientOperationId: { goalId, clientOperationId },
    },
    select: depositSelect,
  });
}

export function findDepositHistoryByGoalId(goalId: string) {
  return prisma.deposit.findMany({
    where: { goalId },
    orderBy: [{ depositDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: depositHistorySelect,
  });
}

export function findDepositDetailByGoalIdAndId(goalId: string, depositId: string) {
  return prisma.deposit.findFirst({
    where: { id: depositId, goalId },
    select: depositDetailSelect,
  });
}

export function sumApprovedDepositAmountsByGoalIds(goalIds: string[]) {
  if (goalIds.length === 0) return Promise.resolve([]);

  return prisma.deposit.groupBy({
    by: ["goalId"],
    where: {
      goalId: { in: goalIds },
      status: "APPROVED",
    },
    _sum: { amount: true },
  });
}
