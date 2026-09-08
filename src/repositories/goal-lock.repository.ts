import { Prisma } from "@prisma/client";

type GoalLockTransaction = Prisma.TransactionClient;

/**
 * Canonical Phase 5 lock order: begin a transaction, lock the PersonalGoal,
 * then read or mutate goal-scoped custodian state. The lock coordinates
 * cooperating writers; it is not an authorization check.
 */
export async function lockPersonalGoalForUpdate(
  transaction: GoalLockTransaction,
  goalId: string,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
      FROM "PersonalGoal"
      WHERE "id" = ${goalId}
      FOR UPDATE
    `,
  );

  return rows[0] ?? null;
}
