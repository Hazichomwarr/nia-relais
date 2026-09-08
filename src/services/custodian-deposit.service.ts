import {
  findPendingCustodianDepositForUser,
  findPendingCustodianDepositsForUser,
  type PendingCustodianDepositRecord,
} from "@/src/repositories/custodian-deposit.repository";

export type PendingCustodianDeposit = {
  id: string;
  amount: string;
  depositDate: string;
  note: string | null;
  createdAt: string;
  status: "PENDING";
  verificationMode: "CUSTODIAN";
  goal: {
    id: string;
    name: string;
    currency: string;
  };
  ownerName: string;
  assignment: {
    id: string;
    status: "ACTIVE" | "ENDED";
    displayName: string;
    email: string | null;
  };
};

function serializePendingCustodianDeposit(
  deposit: PendingCustodianDepositRecord,
): PendingCustodianDeposit | null {
  const assignment = deposit.responsibleCustodian;

  if (!assignment || (assignment.status !== "ACTIVE" && assignment.status !== "ENDED")) {
    return null;
  }

  return {
    id: deposit.id,
    amount: deposit.amount.toFixed(2),
    depositDate: deposit.depositDate.toISOString().slice(0, 10),
    note: deposit.note,
    createdAt: deposit.createdAt.toISOString(),
    status: "PENDING",
    verificationMode: "CUSTODIAN",
    goal: {
      id: deposit.goal.id,
      name: deposit.goal.name,
      currency: deposit.goal.currency,
    },
    ownerName: deposit.goal.owner.name,
    assignment: {
      id: assignment.id,
      status: assignment.status,
      displayName: assignment.displayName,
      email: assignment.email,
    },
  };
}

export async function getPendingDepositsForCustodian(authenticatedUserId: string) {
  if (!authenticatedUserId) return [];

  const deposits = await findPendingCustodianDepositsForUser(authenticatedUserId);
  return deposits.flatMap((deposit) => {
    const serialized = serializePendingCustodianDeposit(deposit);
    return serialized ? [serialized] : [];
  });
}

export async function getPendingDepositForCustodian(
  authenticatedUserId: string,
  depositId: string,
) {
  if (!authenticatedUserId || !depositId) return null;

  const deposit = await findPendingCustodianDepositForUser(depositId, authenticatedUserId);
  return deposit ? serializePendingCustodianDeposit(deposit) : null;
}
