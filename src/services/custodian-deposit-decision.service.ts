import {
  approvePendingCustodianDeposit,
  findDepositForCustodianDecision,
  findDepositGoalId,
  rejectPendingCustodianDeposit,
  type CustodianDecisionDepositRecord,
} from "@/src/repositories/custodian-deposit.repository";
import { prisma } from "@/src/prisma";
import { lockPersonalGoalForUpdate } from "@/src/repositories/goal-lock.repository";

export class CustodianDepositDecisionNotFoundError extends Error {
  constructor() {
    super("Deposit not found or unavailable for this custodian.");
    this.name = "CustodianDepositDecisionNotFoundError";
  }
}

export class CustodianDepositDecisionConflictError extends Error {
  constructor() {
    super("This Deposit has already been decided.");
    this.name = "CustodianDepositDecisionConflictError";
  }
}

export class InvalidCustodianDepositRejectionReasonError extends Error {
  constructor() {
    super("A rejection reason is required and must be 500 characters or fewer.");
    this.name = "InvalidCustodianDepositRejectionReasonError";
  }
}

export type CustodianDepositDecisionResult = {
  depositId: string;
  goalId: string;
  amount: string;
  status: "APPROVED" | "REJECTED";
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
};

type DecisionKind = "APPROVE" | "REJECT";

function serializeDecision(deposit: CustodianDecisionDepositRecord): CustodianDepositDecisionResult {
  return {
    depositId: deposit.id,
    goalId: deposit.goalId,
    amount: deposit.amount.toFixed(2),
    status: deposit.status === "APPROVED" ? "APPROVED" : "REJECTED",
    approvedAt: deposit.approvedAt?.toISOString() ?? null,
    rejectedAt: deposit.rejectedAt?.toISOString() ?? null,
    rejectionReason: deposit.rejectionReason,
  };
}

function validateRejectionReason(value: string) {
  const reason = value.trim();
  if (!reason || reason.length > 500) {
    throw new InvalidCustodianDepositRejectionReasonError();
  }

  return reason;
}

function classifyReplay(
  deposit: CustodianDecisionDepositRecord,
  decision: DecisionKind,
) {
  if (decision === "APPROVE" && deposit.status === "APPROVED") {
    return serializeDecision(deposit);
  }

  if (decision === "REJECT" && deposit.status === "REJECTED") {
    return serializeDecision(deposit);
  }

  throw new CustodianDepositDecisionConflictError();
}

async function decideCustodianDeposit(
  depositId: string,
  authenticatedUserId: string,
  decision: DecisionKind,
  rejectionReason?: string,
) {
  if (!depositId || !authenticatedUserId) {
    throw new CustodianDepositDecisionNotFoundError();
  }

  const depositReference = await findDepositGoalId(depositId);
  if (!depositReference) throw new CustodianDepositDecisionNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const lockedGoal = await lockPersonalGoalForUpdate(transaction, depositReference.goalId);
    if (!lockedGoal) throw new CustodianDepositDecisionNotFoundError();

    const deposit = await findDepositForCustodianDecision(
      transaction,
      depositId,
      authenticatedUserId,
    );
    if (!deposit) throw new CustodianDepositDecisionNotFoundError();

    if (deposit.status !== "PENDING") {
      return classifyReplay(deposit, decision);
    }

    const now = new Date();
    const updated = decision === "APPROVE"
      ? await approvePendingCustodianDeposit(transaction, deposit.id, authenticatedUserId, now)
      : await rejectPendingCustodianDeposit(
          transaction,
          deposit.id,
          authenticatedUserId,
          now,
          validateRejectionReason(rejectionReason ?? ""),
        );

    if (updated.count !== 1) {
      const currentDeposit = await findDepositForCustodianDecision(
        transaction,
        depositId,
        authenticatedUserId,
      );
      if (!currentDeposit) throw new CustodianDepositDecisionNotFoundError();
      return classifyReplay(currentDeposit, decision);
    }

    const decidedDeposit = await findDepositForCustodianDecision(
      transaction,
      depositId,
      authenticatedUserId,
    );
    if (!decidedDeposit) throw new CustodianDepositDecisionNotFoundError();

    return serializeDecision(decidedDeposit);
  });
}

export function approveCustodianDeposit(
  depositId: string,
  authenticatedUserId: string,
) {
  return decideCustodianDeposit(depositId, authenticatedUserId, "APPROVE");
}

export function rejectCustodianDeposit(
  depositId: string,
  authenticatedUserId: string,
  rejectionReason: string,
) {
  return decideCustodianDeposit(depositId, authenticatedUserId, "REJECT", rejectionReason);
}
