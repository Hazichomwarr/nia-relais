import "server-only";

import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import { lockPersonalGoalForUpdate } from "@/src/repositories/goal-lock.repository";
import { findGoalForLifecycle } from "@/src/repositories/goal.repository";
import { prisma } from "@/src/prisma";

export class PersonalGoalAbandonmentConflictError extends Error {
  constructor() { super("This goal cannot be abandoned in its current state."); this.name = "PersonalGoalAbandonmentConflictError"; }
}

export type PersonalGoalAbandonmentResult = { goalId: string; status: "ABANDONED"; replayed: boolean };

export async function abandonPersonalGoal(input: { ownerId: string; goalId: string }): Promise<PersonalGoalAbandonmentResult> {
  return prisma.$transaction(async (transaction) => {
    const locked = await lockPersonalGoalForUpdate(transaction, input.goalId);
    if (!locked) throw new GoalNotFoundOrUnauthorizedError();
    const goal = await findGoalForLifecycle(transaction, input.goalId);
    if (!goal || goal.ownerId !== input.ownerId) throw new GoalNotFoundOrUnauthorizedError();
    if (goal.status === "ABANDONED") return { goalId: goal.id, status: "ABANDONED", replayed: true };
    if (goal.status !== "ACTIVE") throw new PersonalGoalAbandonmentConflictError();
    const updated = await transaction.personalGoal.updateMany({ where: { id: goal.id, ownerId: input.ownerId, status: "ACTIVE" }, data: { status: "ABANDONED" } });
    if (updated.count !== 1) throw new PersonalGoalAbandonmentConflictError();
    return { goalId: goal.id, status: "ABANDONED", replayed: false };
  });
}
