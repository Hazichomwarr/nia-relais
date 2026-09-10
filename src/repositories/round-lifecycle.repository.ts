import { Prisma, type PrismaClient } from "@prisma/client";

// Same "Client = PrismaClient | Prisma.TransactionClient" convention as
// every other financial writer's own repository -- every function here
// works both unlocked (the fast fail-fast/replay path) and inside the
// circle row lock (the authoritative fresh-transition path). Narrow,
// explicit mutation functions only -- no generic "update round with
// arbitrary data" helper exists here (7K.13 ticket section 23): the two
// CAS functions at the bottom each transition exactly one column set,
// under exactly one WHERE-status guard, and nothing else.

type Client = PrismaClient | Prisma.TransactionClient;

const lifecycleCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type LifecycleCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof lifecycleCircleSelect;
}>;

export function findCircleForRoundLifecycle(client: Client, circleId: string) {
  return client.savingsCircle.findUnique({
    where: { id: circleId },
    select: lifecycleCircleSelect,
  });
}

const lifecycleRoundSelect = {
  id: true,
  circleId: true,
  roundNumber: true,
  recipientId: true,
  dueDate: true,
  status: true,
  activatedAt: true,
  activatedById: true,
  closedAt: true,
  closedById: true,
} satisfies Prisma.PayoutRoundSelect;

export type LifecycleRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof lifecycleRoundSelect;
}>;

/**
 * Every persisted round for the circle, ordered by roundNumber -- the
 * sole source of both the immutable rotation shape
 * (assertRotationSequenceIntegrity) and the mutable lifecycle-state shape
 * (assertRoundLifecycleStateIntegrity, src/domain/round-lifecycle.ts).
 * One bounded query, never one per round.
 */
export function findRoundsForLifecycle(client: Client, circleId: string) {
  return client.payoutRound.findMany({
    where: { circleId },
    orderBy: { roundNumber: "asc" },
    select: lifecycleRoundSelect,
  });
}

const lifecycleObligationSelect = {
  id: true,
  expectedAmount: true,
  currency: true,
  status: true,
  fulfilledAt: true,
} satisfies Prisma.ContributionObligationSelect;

export type LifecycleObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof lifecycleObligationSelect;
}>;

/**
 * Every obligation for ONE round -- used both to recompute the round's
 * authoritative expected payout (computeExpectedPayoutAmount, reused
 * unchanged from payout-accounting.ts) and to re-derive each obligation's
 * true fulfillment from the confirmed-payment ledger
 * (findConfirmedPaymentSums, reused unchanged from
 * circle-member-dashboard.repository.ts -- never a second, independently
 * reimplemented ledger query).
 */
export function findObligationsForLifecycleRound(client: Client, circleId: string, roundId: string) {
  return client.contributionObligation.findMany({
    where: { circleId, roundId },
    orderBy: { id: "asc" },
    select: lifecycleObligationSelect,
  });
}

export type ConfirmedPaymentSum = {
  readonly obligationId: string;
  readonly confirmedAmount: Prisma.Decimal;
};

/**
 * Batched by design, identical query shape to
 * circle-member-dashboard.repository.ts's own findConfirmedPaymentSums --
 * ported rather than imported unchanged, because that function always
 * queries through the bare `prisma` singleton (it takes no `client`
 * parameter), which would silently bypass this service's own transaction
 * client when called from inside a lock-held transaction. This function
 * is the same "sum CONFIRMED payments, grouped by obligation, in one
 * batched query" logic, parameterized by `client` like every other
 * function in this file, so a fresh re-read genuinely happens through the
 * SAME transaction the caller is already inside.
 */
export async function findConfirmedPaymentSumsForLifecycle(
  client: Client,
  obligationIds: readonly string[],
): Promise<ConfirmedPaymentSum[]> {
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

const lifecyclePayoutSelect = {
  id: true,
  circleId: true,
  roundId: true,
  amount: true,
  currency: true,
  status: true,
  recordedAt: true,
  recordedById: true,
  confirmedAt: true,
  confirmedByMemberId: true,
  disputedAt: true,
  disputedByMemberId: true,
  disputeReason: true,
} satisfies Prisma.PayoutSelect;

export type LifecyclePayoutRecord = Prisma.PayoutGetPayload<{
  select: typeof lifecyclePayoutSelect;
}>;

/**
 * The round's one persisted Payout row, if any (Payout.@@unique([roundId])
 * already makes more than one structurally impossible). Selects the full
 * confirmation/dispute provenance this ticket's own closure predicate
 * needs (7K.13 section 13) -- a superset of payout-recording.repository
 * .ts's own narrower payoutSelect, kept as its own select here rather than
 * widening that one, matching this codebase's per-consumer-select
 * discipline.
 */
export function findPayoutForLifecycleRound(client: Client, circleId: string, roundId: string) {
  return client.payout.findFirst({
    where: { circleId, roundId },
    select: lifecyclePayoutSelect,
  });
}

/**
 * The compare-and-swap round-1 activation transition: UPCOMING -> ACTIVE,
 * only. An affected count of 0 means round 1 was not UPCOMING at the
 * instant of the write -- the caller must re-read fresh state and resolve
 * it (replay / integrity conflict), never assume success.
 */
export function activateLifecycleRound(
  client: Client,
  input: { roundId: string; circleId: string; activatedAt: Date; activatedById: string },
) {
  return client.payoutRound.updateMany({
    where: { id: input.roundId, circleId: input.circleId, status: "UPCOMING" },
    data: { status: "ACTIVE", activatedAt: input.activatedAt, activatedById: input.activatedById },
  });
}

/**
 * The compare-and-swap round-closure transition: ACTIVE -> CLOSED, only.
 * Never touches any other round -- activating a successor (if one
 * exists) is a separate call to activateLifecycleRound, made by the
 * SAME caller inside the SAME transaction (round-lifecycle.service.ts's
 * own atomicity guarantee, 7K.11 §21.12), never bundled into one SQL
 * statement across two different rows.
 */
export function closeLifecycleRound(
  client: Client,
  input: { roundId: string; circleId: string; closedAt: Date; closedById: string },
) {
  return client.payoutRound.updateMany({
    where: { id: input.roundId, circleId: input.circleId, status: "ACTIVE" },
    data: { status: "CLOSED", closedAt: input.closedAt, closedById: input.closedById },
  });
}
