import { Prisma, type PrismaClient } from "@prisma/client";

type CleanupClient = PrismaClient | Prisma.TransactionClient;

/**
 * Deletes a single, bounded batch of expired CircleMemberAuthRateLimitBucket
 * rows and returns how many were removed.
 *
 * Deterministic selection: PostgreSQL cannot DELETE with ORDER BY/LIMIT
 * directly, so the candidate set is chosen via a subquery ordered by
 * ("expiresAt" ASC, id ASC) -- oldest-expired-first, with id as a stable
 * tiebreaker -- and only those specific rows (by primary key) are deleted.
 * This bounds the amount of work and lock time any single invocation can
 * take, regardless of how large the backlog is; a scheduler calling this
 * repeatedly drains a larger backlog gradually rather than one invocation
 * attempting an unbounded DELETE.
 *
 * "expiresAt" is compared against PostgreSQL's own clock (`now()`, cast to
 * UTC the same way the bucket-writing repository does), never JS
 * `Date.now()`, and only ever selects rows whose window has already fully
 * ended -- an active-window row's `expiresAt` is always in the future
 * relative to `now()` and can never be selected here.
 *
 * Concurrency: two overlapping invocations racing on overlapping candidate
 * sets are resolved safely by PostgreSQL's own row locking during the
 * DELETE -- whichever transaction commits first removes the rows; the
 * other's DELETE simply finds those specific ids already gone (0 rows
 * affected for them, no error, no deadlock), since this is a single
 * self-contained statement with no cross-table lock ordering to manage.
 */
export async function deleteExpiredRateLimitBucketBatch(
  client: CleanupClient,
  batchSize: number,
): Promise<{ deletedCount: number }> {
  const deletedCount = await client.$executeRaw(Prisma.sql`
    DELETE FROM "CircleMemberAuthRateLimitBucket"
    WHERE id IN (
      SELECT id
      FROM "CircleMemberAuthRateLimitBucket"
      WHERE "expiresAt" < (now() AT TIME ZONE 'UTC')
      ORDER BY "expiresAt" ASC, id ASC
      LIMIT ${batchSize}
    )
  `);

  return { deletedCount };
}
