import { Prisma } from "@prisma/client";

import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import {
  countPendingDepositsForGoal,
  sumApprovedDepositAmountForGoal,
} from "@/src/repositories/deposit.repository";
import {
  completeActivePersonalGoal,
  findGoalForLifecycle,
  type LifecycleGoalRecord,
} from "@/src/repositories/goal.repository";
import { lockPersonalGoalForUpdate } from "@/src/repositories/goal-lock.repository";
import { prisma } from "@/src/prisma";
import { getGoalCompletionEligibility } from "@/src/services/goal.service";

export class PersonalGoalCompletionNotEligibleError extends Error {
  constructor() {
    super("This goal is not eligible for completion.");
    this.name = "PersonalGoalCompletionNotEligibleError";
  }
}

export class PersonalGoalCompletionConflictError extends Error {
  constructor() {
    super("This goal cannot be completed in its current state.");
    this.name = "PersonalGoalCompletionConflictError";
  }
}

export type PersonalGoalCompletionResult = {
  goalId: string;
  status: "COMPLETED";
  completedAt: string | null;
  completedById: string | null;
  savedAmount: string;
  targetAmount: string;
  pendingDepositCount: number;
  alreadyCompleted: boolean;
};

function todayUtcDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function serializeCompletion(
  goal: LifecycleGoalRecord,
  savedAmount: Prisma.Decimal,
  pendingDepositCount: number,
  alreadyCompleted: boolean,
): PersonalGoalCompletionResult {
  return {
    goalId: goal.id,
    status: "COMPLETED",
    completedAt: goal.completedAt?.toISOString() ?? null,
    completedById: goal.completedById,
    savedAmount: savedAmount.toFixed(2),
    targetAmount: goal.targetAmount.toFixed(2),
    pendingDepositCount,
    alreadyCompleted,
  };
}

function assertOwner(goal: LifecycleGoalRecord, ownerId: string) {
  if (goal.ownerId !== ownerId) throw new GoalNotFoundOrUnauthorizedError();
}

async function getCompletionBalances(
  transaction: Prisma.TransactionClient,
  goalId: string,
) {
  const [savedAmount, pendingDepositCount] = await Promise.all([
    sumApprovedDepositAmountForGoal(transaction, goalId),
    countPendingDepositsForGoal(transaction, goalId),
  ]);

  return { savedAmount, pendingDepositCount };
}

function assertActiveOrCompleted(goal: LifecycleGoalRecord) {
  if (goal.status === "ARCHIVED") {
    throw new PersonalGoalCompletionConflictError();
  }
}

export async function completePersonalGoal(input: {
  ownerId: string;
  goalId: string;
}): Promise<PersonalGoalCompletionResult> {
  if (!input.ownerId || !input.goalId) throw new GoalNotFoundOrUnauthorizedError();

  return prisma.$transaction(async (transaction) => {
    const lockedGoal = await lockPersonalGoalForUpdate(transaction, input.goalId);
    if (!lockedGoal) throw new GoalNotFoundOrUnauthorizedError();

    const goal = await findGoalForLifecycle(transaction, input.goalId);
    if (!goal) throw new GoalNotFoundOrUnauthorizedError();
    assertOwner(goal, input.ownerId);
    assertActiveOrCompleted(goal);

    const balances = await getCompletionBalances(transaction, goal.id);
    if (goal.status === "COMPLETED") {
      return serializeCompletion(goal, balances.savedAmount, balances.pendingDepositCount, true);
    }

    const today = toUtcDate(todayUtcDateOnly());
    const eligibility = getGoalCompletionEligibility({
      status: goal.status,
      savedAmount: balances.savedAmount,
      targetAmount: goal.targetAmount,
      unlockDate: goal.unlockDate,
      today,
    });
    if (!eligibility.completionEligible) throw new PersonalGoalCompletionNotEligibleError();

    const updated = await completeActivePersonalGoal(transaction, {
      goalId: goal.id,
      ownerId: input.ownerId,
      completedAt: new Date(),
    });

    if (updated.count !== 1) {
      const currentGoal = await findGoalForLifecycle(transaction, goal.id);
      if (!currentGoal) throw new GoalNotFoundOrUnauthorizedError();
      assertOwner(currentGoal, input.ownerId);
      assertActiveOrCompleted(currentGoal);

      const currentBalances = await getCompletionBalances(transaction, currentGoal.id);
      if (currentGoal.status === "COMPLETED") {
        return serializeCompletion(currentGoal, currentBalances.savedAmount, currentBalances.pendingDepositCount, true);
      }

      throw new PersonalGoalCompletionConflictError();
    }

    const completedGoal = await findGoalForLifecycle(transaction, goal.id);
    if (!completedGoal) throw new GoalNotFoundOrUnauthorizedError();

    return serializeCompletion(
      completedGoal,
      balances.savedAmount,
      balances.pendingDepositCount,
      false,
    );
  });
}
