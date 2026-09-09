import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

type RateLimitTransactionClient = Prisma.TransactionClient;

export type RateLimitScope = "SOURCE" | "TARGET" | "GLOBAL";

/**
 * Atomically increments (or creates) the counter for the fixed window
 * containing "now", using PostgreSQL's own clock -- never `Date.now()` --
 * so every application instance agrees on window boundaries regardless of
 * local clock skew.
 *
 * `to_timestamp(...)` yields a `timestamptz`; converting it with
 * `AT TIME ZONE 'UTC'` before it lands in the `timestamp without time zone`
 * columns pins the stored wall-clock value to UTC explicitly, rather than
 * leaving it to whatever the database session's timezone setting happens to
 * be. This is the same UTC-anchored convention the rest of the codebase
 * uses for date-only fields.
 *
 * `INSERT ... ON CONFLICT (scope, "keyHash", "windowStart") DO UPDATE ...
 * RETURNING` is atomic at the row level in PostgreSQL: two concurrent
 * callers contending for the exact same bucket row are safely serialized by
 * PostgreSQL's own row lock during conflict resolution. No explicit
 * `SELECT ... FOR UPDATE` is needed to make a single scope's counter
 * correct under concurrency.
 */
export async function incrementRateLimitBucket(
  transaction: RateLimitTransactionClient,
  input: { scope: RateLimitScope; keyHash: string; windowSeconds: number },
): Promise<{ attemptCount: number }> {
  const id = randomUUID();

  const rows = await transaction.$queryRaw<Array<{ attemptCount: number }>>(Prisma.sql`
    INSERT INTO "CircleMemberAuthRateLimitBucket"
      (id, scope, "keyHash", "windowStart", "attemptCount", "expiresAt", "createdAt", "updatedAt")
    VALUES (
      ${id},
      ${input.scope}::"CircleMemberAuthRateLimitScope",
      ${input.keyHash},
      (to_timestamp(floor(extract(epoch from now()) / ${input.windowSeconds}) * ${input.windowSeconds}) AT TIME ZONE 'UTC'),
      1,
      (to_timestamp(floor(extract(epoch from now()) / ${input.windowSeconds}) * ${input.windowSeconds} + ${input.windowSeconds}) AT TIME ZONE 'UTC'),
      (now() AT TIME ZONE 'UTC'),
      (now() AT TIME ZONE 'UTC')
    )
    ON CONFLICT (scope, "keyHash", "windowStart")
    DO UPDATE SET
      "attemptCount" = "CircleMemberAuthRateLimitBucket"."attemptCount" + 1,
      "updatedAt" = (now() AT TIME ZONE 'UTC')
    RETURNING "attemptCount"
  `);

  return { attemptCount: rows[0].attemptCount };
}

/**
 * Read-only helper for tests: fetches a bucket by its natural key without
 * mutating it. Never used by the admission decision itself.
 */
export async function findRateLimitBucket(
  transaction: RateLimitTransactionClient,
  input: { scope: RateLimitScope; keyHash: string; windowSeconds: number },
) {
  return transaction.$queryRaw<
    Array<{ attemptCount: number; windowStart: Date; expiresAt: Date }>
  >(Prisma.sql`
    SELECT "attemptCount", "windowStart", "expiresAt"
    FROM "CircleMemberAuthRateLimitBucket"
    WHERE "scope" = ${input.scope}::"CircleMemberAuthRateLimitScope"
      AND "keyHash" = ${input.keyHash}
      AND "windowStart" = (to_timestamp(floor(extract(epoch from now()) / ${input.windowSeconds}) * ${input.windowSeconds}) AT TIME ZONE 'UTC')
  `);
}
