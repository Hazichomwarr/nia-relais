import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

type CustodianDepositTransaction = Prisma.TransactionClient;

const pendingCustodianDepositSelect = {
  id: true,
  amount: true,
  depositDate: true,
  note: true,
  status: true,
  verificationMode: true,
  createdAt: true,
  goal: {
    select: {
      id: true,
      name: true,
      currency: true,
      owner: { select: { name: true } },
    },
  },
  responsibleCustodian: {
    select: {
      id: true,
      userId: true,
      status: true,
      displayName: true,
      email: true,
    },
  },
} satisfies Prisma.DepositSelect;

export type PendingCustodianDepositRecord = Prisma.DepositGetPayload<{
  select: typeof pendingCustodianDepositSelect;
}>;

const decisionDepositSelect = {
  id: true,
  goalId: true,
  amount: true,
  status: true,
  verificationMode: true,
  approvedAt: true,
  approvedById: true,
  rejectedAt: true,
  rejectedById: true,
  rejectionReason: true,
  responsibleCustodian: {
    select: {
      id: true,
      userId: true,
      status: true,
    },
  },
} satisfies Prisma.DepositSelect;

export type CustodianDecisionDepositRecord = Prisma.DepositGetPayload<{
  select: typeof decisionDepositSelect;
}>;

const pendingCustodianWhere = (userId: string): Prisma.DepositWhereInput => ({
  verificationMode: "CUSTODIAN" as const,
  status: "PENDING" as const,
  responsibleCustodian: {
    is: {
      userId,
      status: { in: ["ACTIVE", "ENDED"] },
    },
  },
});

export function findPendingCustodianDepositsForUser(userId: string) {
  return prisma.deposit.findMany({
    where: pendingCustodianWhere(userId),
    orderBy: [{ depositDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: pendingCustodianDepositSelect,
  });
}

export function findPendingCustodianDepositForUser(depositId: string, userId: string) {
  return prisma.deposit.findFirst({
    where: {
      id: depositId,
      ...pendingCustodianWhere(userId),
    },
    select: pendingCustodianDepositSelect,
  });
}

export function findDepositGoalId(depositId: string) {
  return prisma.deposit.findUnique({
    where: { id: depositId },
    select: { goalId: true },
  });
}

export function findDepositForCustodianDecision(
  transaction: CustodianDepositTransaction,
  depositId: string,
  userId: string,
) {
  return transaction.deposit.findFirst({
    where: {
      id: depositId,
      verificationMode: "CUSTODIAN",
      responsibleCustodian: {
        is: {
          userId,
          status: { in: ["ACTIVE", "ENDED"] },
        },
      },
    },
    select: decisionDepositSelect,
  });
}

export function approvePendingCustodianDeposit(
  transaction: CustodianDepositTransaction,
  depositId: string,
  approvedById: string,
  approvedAt: Date,
) {
  return transaction.deposit.updateMany({
    where: { id: depositId, status: "PENDING" },
    data: { status: "APPROVED", approvedAt, approvedById },
  });
}

export function rejectPendingCustodianDeposit(
  transaction: CustodianDepositTransaction,
  depositId: string,
  rejectedById: string,
  rejectedAt: Date,
  rejectionReason: string,
) {
  return transaction.deposit.updateMany({
    where: { id: depositId, status: "PENDING" },
    data: { status: "REJECTED", rejectedAt, rejectedById, rejectionReason },
  });
}
