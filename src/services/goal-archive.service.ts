import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import { countPendingDepositsForGoal } from "@/src/repositories/deposit.repository";
import {
  archiveCompletedPersonalGoal,
  findGoalForLifecycle,
  type LifecycleGoalRecord,
} from "@/src/repositories/goal.repository";
import { lockPersonalGoalForUpdate } from "@/src/repositories/goal-lock.repository";
import { prisma } from "@/src/prisma";

export class PersonalGoalArchivePendingDepositsError extends Error {
  constructor() {
    super("This goal still has savings waiting for confirmation.");
    this.name = "PersonalGoalArchivePendingDepositsError";
  }
}

export class PersonalGoalArchiveConflictError extends Error {
  constructor() {
    super("This goal cannot be archived in its current state.");
    this.name = "PersonalGoalArchiveConflictError";
  }
}

export type PersonalGoalArchiveResult = {
  goalId: string;
  status: "ARCHIVED";
  completedAt: string | null;
  completedById: string | null;
  archivedAt: string | null;
  archivedById: string | null;
  pendingDepositCount: number;
  alreadyArchived: boolean;
};

function assertOwner(goal: LifecycleGoalRecord, ownerId: string) {
  if (goal.ownerId !== ownerId) throw new GoalNotFoundOrUnauthorizedError();
}

function serializeArchive(
  goal: LifecycleGoalRecord,
  pendingDepositCount: number,
  alreadyArchived: boolean,
): PersonalGoalArchiveResult {
  return {
    goalId: goal.id,
    status: "ARCHIVED",
    completedAt: goal.completedAt?.toISOString() ?? null,
    completedById: goal.completedById,
    archivedAt: goal.archivedAt?.toISOString() ?? null,
    archivedById: goal.archivedById,
    pendingDepositCount,
    alreadyArchived,
  };
}

function assertCompletedOrArchived(goal: LifecycleGoalRecord) {
  if (goal.status === "ACTIVE") throw new PersonalGoalArchiveConflictError();
}

export async function archivePersonalGoal(input: {
  ownerId: string;
  goalId: string;
}): Promise<PersonalGoalArchiveResult> {
  if (!input.ownerId || !input.goalId) throw new GoalNotFoundOrUnauthorizedError();

  return prisma.$transaction(async (transaction) => {
    const lockedGoal = await lockPersonalGoalForUpdate(transaction, input.goalId);
    if (!lockedGoal) throw new GoalNotFoundOrUnauthorizedError();

    const goal = await findGoalForLifecycle(transaction, input.goalId);
    if (!goal) throw new GoalNotFoundOrUnauthorizedError();
    assertOwner(goal, input.ownerId);
    assertCompletedOrArchived(goal);

    const pendingDepositCount = await countPendingDepositsForGoal(transaction, goal.id);
    if (goal.status === "ARCHIVED") {
      return serializeArchive(goal, pendingDepositCount, true);
    }

    if (pendingDepositCount > 0) throw new PersonalGoalArchivePendingDepositsError();

    const updated = await archiveCompletedPersonalGoal(transaction, {
      goalId: goal.id,
      ownerId: input.ownerId,
      archivedAt: new Date(),
    });

    if (updated.count !== 1) {
      const currentGoal = await findGoalForLifecycle(transaction, goal.id);
      if (!currentGoal) throw new GoalNotFoundOrUnauthorizedError();
      assertOwner(currentGoal, input.ownerId);
      assertCompletedOrArchived(currentGoal);

      const currentPendingDepositCount = await countPendingDepositsForGoal(transaction, currentGoal.id);
      if (currentGoal.status === "ARCHIVED") {
        return serializeArchive(currentGoal, currentPendingDepositCount, true);
      }

      if (currentPendingDepositCount > 0) throw new PersonalGoalArchivePendingDepositsError();
      throw new PersonalGoalArchiveConflictError();
    }

    const archivedGoal = await findGoalForLifecycle(transaction, goal.id);
    if (!archivedGoal) throw new GoalNotFoundOrUnauthorizedError();

    return serializeArchive(archivedGoal, pendingDepositCount, false);
  });
}
