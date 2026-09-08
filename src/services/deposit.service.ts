import { Prisma } from "@prisma/client";

import { requireGoalOwner } from "@/src/auth/require-goal-owner";
import {
  createDepositRecord,
  findDepositByOperationId,
  findDepositCreationContext,
  findDepositDetailByGoalIdAndId,
  findDepositHistoryByGoalId,
  type DepositDetailRecord,
  type DepositHistoryRecord,
  type DepositRecord,
} from "@/src/repositories/deposit.repository";
import { prisma } from "@/src/prisma";
import { lockPersonalGoalForUpdate } from "@/src/repositories/goal-lock.repository";
import type { CreateDepositInput } from "@/src/validations/deposit.schema";

export class InvalidDepositError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDepositError";
  }
}

export class GoalNotAvailableForDepositsError extends Error {
  constructor() {
    super("This goal is not available for deposits.");
    this.name = "GoalNotAvailableForDepositsError";
  }
}

export class MultipleActiveCustodiansError extends Error {
  constructor() {
    super("This goal has an ambiguous custodian state.");
    this.name = "MultipleActiveCustodiansError";
  }
}

export type CreatedDeposit = {
  id: string;
  goalId: string;
  amount: string;
  depositDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  verificationMode: "OWNER" | "CUSTODIAN";
  responsibleCustodianId: string | null;
  recordedById: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  note: string | null;
  createdAt: string;
};

export type DepositHistoryItem = {
  id: string;
  goalId: string;
  amount: string;
  depositDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  verificationMode: "OWNER" | "CUSTODIAN";
  note: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type DepositDetail = DepositHistoryItem & {
  recordedByName: string;
  responsibleCustodianName: string | null;
  approvedByName: string | null;
  rejectedByName: string | null;
};

function todayUtcDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toMoney(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new InvalidDepositError("Amount must have no more than two decimal places.");
  }

  const [whole] = value.split(".");
  if (whole.length > 16) {
    throw new InvalidDepositError("Amount must fit DECIMAL(18,2).");
  }

  const amount = new Prisma.Decimal(value);
  if (!amount.gt(0)) {
    throw new InvalidDepositError("Amount must be greater than zero.");
  }

  return amount;
}

function serializeDeposit(deposit: DepositRecord): CreatedDeposit {
  return {
    id: deposit.id,
    goalId: deposit.goalId,
    amount: deposit.amount.toFixed(2),
    depositDate: deposit.depositDate.toISOString().slice(0, 10),
    status: deposit.status,
    verificationMode: deposit.verificationMode,
    responsibleCustodianId: deposit.responsibleCustodianId,
    recordedById: deposit.recordedById,
    approvedAt: deposit.approvedAt?.toISOString() ?? null,
    rejectedAt: deposit.rejectedAt?.toISOString() ?? null,
    note: deposit.note,
    createdAt: deposit.createdAt.toISOString(),
  };
}

function serializeDepositHistoryItem(deposit: DepositHistoryRecord): DepositHistoryItem {
  return {
    id: deposit.id,
    goalId: deposit.goalId,
    amount: deposit.amount.toFixed(2),
    depositDate: deposit.depositDate.toISOString().slice(0, 10),
    status: deposit.status,
    verificationMode: deposit.verificationMode,
    note: deposit.note,
    approvedAt: deposit.approvedAt?.toISOString() ?? null,
    rejectedAt: deposit.rejectedAt?.toISOString() ?? null,
    rejectionReason: deposit.rejectionReason,
    createdAt: deposit.createdAt.toISOString(),
  };
}

function serializeDepositDetail(deposit: DepositDetailRecord): DepositDetail {
  return {
    ...serializeDepositHistoryItem(deposit),
    recordedByName: deposit.recordedBy.name,
    responsibleCustodianName: deposit.responsibleCustodian?.displayName ?? null,
    approvedByName: deposit.approvedBy?.name ?? null,
    rejectedByName: deposit.rejectedBy?.name ?? null,
  };
}

function isClientOperationConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function createDeposit(input: CreateDepositInput) {
  const { user, goal } = await requireGoalOwner(input.goalId);
  const existing = await findDepositByOperationId(input.goalId, input.clientOperationId);

  if (existing) return serializeDeposit(existing);

  const today = todayUtcDateOnly();

  if (goal.status !== "ACTIVE") {
    throw new GoalNotAvailableForDepositsError();
  }

  if (input.depositDate > today || input.depositDate < goal.startDate.toISOString().slice(0, 10)) {
    throw new InvalidDepositError("Deposit date is outside the goal timeline.");
  }

  const amount = toMoney(input.amount);

  try {
    const deposit = await prisma.$transaction(async (transaction) => {
      const lockedGoal = await lockPersonalGoalForUpdate(transaction, input.goalId);

      if (!lockedGoal) {
        throw new GoalNotAvailableForDepositsError();
      }

      const context = await findDepositCreationContext(transaction, input.goalId, user.id);

      if (!context || context.status !== "ACTIVE") {
        throw new GoalNotAvailableForDepositsError();
      }

      if (context.custodians.length > 1) {
        throw new MultipleActiveCustodiansError();
      }

      const responsibleCustodianId = context.custodians[0]?.id ?? null;
      const verificationMode = responsibleCustodianId ? "CUSTODIAN" : "OWNER";
      const approvedAt = verificationMode === "OWNER" ? new Date() : null;

      return createDepositRecord(transaction, {
        goalId: input.goalId,
        amount,
        depositDate: toUtcDate(input.depositDate),
        recordedById: user.id,
        verificationMode,
        responsibleCustodianId,
        clientOperationId: input.clientOperationId,
        status: verificationMode === "OWNER" ? "APPROVED" : "PENDING",
        approvedById: verificationMode === "OWNER" ? user.id : null,
        approvedAt,
        note: input.note ?? null,
      });
    });

    return serializeDeposit(deposit);
  } catch (error) {
    if (!isClientOperationConflict(error)) throw error;

    const racedDeposit = await findDepositByOperationId(input.goalId, input.clientOperationId);
    if (racedDeposit) return serializeDeposit(racedDeposit);

    throw new InvalidDepositError("This deposit could not be created.");
  }
}

export async function getDepositHistoryForGoal(goalId: string) {
  const deposits = await findDepositHistoryByGoalId(goalId);
  return deposits.map(serializeDepositHistoryItem);
}

export async function getDepositDetailForGoal(goalId: string, depositId: string) {
  const deposit = await findDepositDetailByGoalIdAndId(goalId, depositId);
  return deposit ? serializeDepositDetail(deposit) : null;
}
