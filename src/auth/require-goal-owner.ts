import "server-only";

import { requireUser } from "@/src/auth/require-user";
import { findPersonalGoalByIdAndOwnerId } from "@/src/repositories/deposit.repository";

export class GoalNotFoundOrUnauthorizedError extends Error {
  constructor() {
    super("Goal not found.");
    this.name = "GoalNotFoundOrUnauthorizedError";
  }
}

export async function requireGoalOwner(goalId: string) {
  const user = await requireUser();
  const goal = await findPersonalGoalByIdAndOwnerId(goalId, user.id);

  if (!goal) throw new GoalNotFoundOrUnauthorizedError();

  return { user, goal };
}
