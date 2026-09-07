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

export type DepositRecord = Prisma.DepositGetPayload<{
  select: typeof depositSelect;
}>;

type DepositClient = Prisma.TransactionClient;

export function findPersonalGoalByIdAndOwnerId(goalId: string, ownerId: string) {
  return prisma.personalGoal.findFirst({
    where: { id: goalId, ownerId },
    select: {
      id: true,
      ownerId: true,
      status: true,
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
