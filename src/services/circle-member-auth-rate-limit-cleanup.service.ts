import { prisma } from "@/src/prisma";
import { deleteExpiredRateLimitBucketBatch } from "@/src/repositories/circle-member-auth-rate-limit-cleanup.repository";

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const MIN_BATCH_SIZE = 1;

export type MemberAuthRateLimitCleanupResult =
  | { readonly ok: true; readonly deletedCount: number }
  | { readonly ok: false };

function clampBatchSize(requested: number | undefined): number {
  const value = requested ?? DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(Math.trunc(value), MIN_BATCH_SIZE), MAX_BATCH_SIZE);
}

/**
 * Deletes one bounded batch (default 500, max 1000) of expired
 * CircleMemberAuthRateLimitBucket rows. Intended to be invoked repeatedly on
 * a schedule (see docs/security/member-auth-rate-limit-retention.md) --
 * each call only ever removes what has already expired as of PostgreSQL's
 * own clock, never the current window's row for any scope, and never
 * touches any other table.
 *
 * This is completely independent of checkMemberAuthenticationRateLimit: a
 * cleanup failure here has no path back into the limiter's own admission
 * decision. The limiter does not call this, wait on this, or change
 * behavior based on this. A cleanup failure cannot disable or bypass
 * authentication limiting, and the limiter continues to fail closed on its
 * own store errors independently of whether cleanup is healthy.
 *
 * Never throws. Returns `{ ok: false }` on any internal failure so a caller
 * (e.g. a future scheduled route) can log/retry without a crash; returns
 * only the minimal operational count on success, never bucket keys, scopes,
 * or any source/credential material.
 */
export async function cleanupExpiredMemberAuthRateLimitBuckets(input?: {
  batchSize?: number;
}): Promise<MemberAuthRateLimitCleanupResult> {
  const batchSize = clampBatchSize(input?.batchSize);

  try {
    const { deletedCount } = await deleteExpiredRateLimitBucketBatch(prisma, batchSize);
    return { ok: true, deletedCount };
  } catch (error) {
    console.error(
      "[cleanupExpiredMemberAuthRateLimitBuckets] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { ok: false };
  }
}
