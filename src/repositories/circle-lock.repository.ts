import { Prisma } from "@prisma/client";

type CircleLockTransaction = Prisma.TransactionClient;

/**
 * Canonical SUSU lock order: begin a transaction, lock the SavingsCircle,
 * then read or mutate circle-scoped state. The lock coordinates writers; it
 * does not establish owner authority.
 */
export async function lockSavingsCircleForUpdate(
  transaction: CircleLockTransaction,
  circleId: string,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
      FROM "SavingsCircle"
      WHERE "id" = ${circleId}
      FOR UPDATE
    `,
  );

  return rows[0] ?? null;
}
