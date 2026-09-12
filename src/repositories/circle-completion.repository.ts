import { Prisma, type PrismaClient } from "@prisma/client";

// Same "Client = PrismaClient | Prisma.TransactionClient" convention as
// round-lifecycle.repository.ts -- every function here works both
// unlocked (the fast fail-fast/replay pre-check) and inside the circle
// row lock (the authoritative fresh-transition path). Narrow, explicit
// functions only: exactly one CAS mutation (completeActiveCircle), and
// otherwise read-only queries batched across the WHOLE circle (never one
// round-trip per round) -- mirrors payout-owner-read.repository.ts's own
// batching shape, ported here (not imported) for the same reason
// round-lifecycle.repository.ts's own findConfirmedPaymentSumsForLifecycle
// is a separate, client-parameterized port rather than an import: a bare
// `prisma`-only function would silently bypass this service's own
// transaction client when called from inside the lock-held transaction.

type Client = PrismaClient | Prisma.TransactionClient;

const completionCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
  activatedAt: true,
  activatedById: true,
  completedAt: true,
  completedById: true,
  archivedAt: true,
  archivedById: true,
} satisfies Prisma.SavingsCircleSelect;

export type CompletionCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof completionCircleSelect;
}>;

export function findCircleForCompletion(client: Client, circleId: string) {
  return client.savingsCircle.findUnique({
    where: { id: circleId },
    select: completionCircleSelect,
  });
}

const completionObligationSelect = {
  id: true,
  roundId: true,
  expectedAmount: true,
  currency: true,
  status: true,
  fulfilledAt: true,
} satisfies Prisma.ContributionObligationSelect;

export type CompletionObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof completionObligationSelect;
}>;

/**
 * Every obligation for the circle, across every round -- one bounded
 * query, never one per round. The service groups these by roundId itself
 * (mirrors payout-owner-read.repository.ts's own findObligationsForOwnerPayouts
 * batching shape, ported here so a fresh re-read genuinely happens through
 * the caller's own transaction client).
 */
export function findObligationsForCompletion(client: Client, circleId: string) {
  return client.contributionObligation.findMany({
    where: { circleId },
    orderBy: [{ roundId: "asc" }, { id: "asc" }],
    select: completionObligationSelect,
  });
}

export type CompletionConfirmedPaymentSum = {
  readonly obligationId: string;
  readonly confirmedAmount: Prisma.Decimal;
};

/**
 * Confirmed-payment ledger sums for every obligation supplied, in one
 * batched query -- identical shape to round-lifecycle.repository.ts's own
 * findConfirmedPaymentSumsForLifecycle, generalized here to accept
 * obligation ids spanning the whole circle (every round) rather than just
 * one round's own obligations.
 */
export async function findConfirmedPaymentSumsForCompletion(
  client: Client,
  obligationIds: readonly string[],
): Promise<CompletionConfirmedPaymentSum[]> {
  if (obligationIds.length === 0) return [];

  const grouped = await client.contributionPayment.groupBy({
    by: ["obligationId"],
    where: { obligationId: { in: [...obligationIds] }, status: "CONFIRMED" },
    _sum: { amount: true },
  });

  return grouped.map((row) => ({
    obligationId: row.obligationId,
    confirmedAmount: row._sum.amount ?? new Prisma.Decimal(0),
  }));
}

const completionPayoutSelect = {
  id: true,
  roundId: true,
  amount: true,
  currency: true,
  status: true,
  recordedById: true,
  confirmedAt: true,
  confirmedByMemberId: true,
  disputedAt: true,
  disputedByMemberId: true,
  disputeReason: true,
} satisfies Prisma.PayoutSelect;

export type CompletionPayoutRecord = Prisma.PayoutGetPayload<{
  select: typeof completionPayoutSelect;
}>;

/**
 * Every persisted Payout row for the circle -- one bounded query, never
 * one per round. Payout.@@unique([roundId]) already makes more than one
 * row per round structurally impossible; the service pairs each with its
 * round by roundId.
 */
export function findPayoutsForCompletion(client: Client, circleId: string) {
  return client.payout.findMany({
    where: { circleId },
    select: completionPayoutSelect,
  });
}

/**
 * The compare-and-swap circle-completion transition: ACTIVE -> COMPLETED,
 * only -- guarded by ownerId in the same WHERE clause as the status check
 * (mirrors completeActivePersonalGoal's own ownerId+status CAS guard in
 * goal.repository.ts), never a separate unguarded update. Writes exactly
 * status/completedAt/completedById; activatedAt/activatedById/archivedAt/
 * archivedById are never touched here, and no PayoutRound/
 * ContributionObligation/ContributionPayment/Payout/CircleMember row is
 * ever written by this function or by anything else in this module.
 */
export function completeActiveCircle(
  client: Client,
  input: { circleId: string; ownerId: string; completedAt: Date },
) {
  return client.savingsCircle.updateMany({
    where: { id: input.circleId, ownerId: input.ownerId, status: "ACTIVE" },
    data: {
      status: "COMPLETED",
      completedAt: input.completedAt,
      completedById: input.ownerId,
    },
  });
}
