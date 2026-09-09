import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Every function here is a plain, independent, bounded read -- no
// transaction is used because nothing here writes, and a dashboard display
// tolerates a few milliseconds of cross-query staleness far better than it
// would tolerate the added latency/locking of wrapping several unrelated
// reads in one interactive transaction. This mirrors the existing read-only
// aggregation style in goal.service.ts (Promise.all over independent
// per-goal totals), not the read-then-write transactional style used by
// activateCircle or verifyCircleMemberCredentials.

const circleSummarySelect = {
  id: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  status: true,
  startDate: true,
} satisfies Prisma.SavingsCircleSelect;

export type CircleSummaryRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof circleSummarySelect;
}>;

export function findCircleSummary(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: circleSummarySelect,
  });
}

const memberSummarySelect = {
  id: true,
  circleId: true,
  displayName: true,
  payoutOrder: true,
  status: true,
} satisfies Prisma.CircleMemberSelect;

export type MemberSummaryRecord = Prisma.CircleMemberGetPayload<{
  select: typeof memberSummarySelect;
}>;

/**
 * Scoped by the (id, circleId) compound unique key -- this is itself the
 * cross-circle guard: a real memberId that belongs to a DIFFERENT circle
 * than the one requested resolves to null here, identically to a memberId
 * that doesn't exist at all. There is no separate "does this member belong
 * to this circle" check anywhere else because this query shape makes an
 * incorrect match structurally impossible.
 */
export function findMemberSummary(circleId: string, memberId: string) {
  return prisma.circleMember.findUnique({
    where: { id_circleId: { id: memberId, circleId } },
    select: memberSummarySelect,
  });
}

const roundScheduleSelect = {
  id: true,
  roundNumber: true,
  dueDate: true,
  status: true,
  recipientId: true,
  recipient: { select: { displayName: true } },
} satisfies Prisma.PayoutRoundSelect;

export type RoundScheduleRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof roundScheduleSelect;
}>;

export function findRoundsForCircle(circleId: string) {
  return prisma.payoutRound.findMany({
    where: { circleId },
    orderBy: { roundNumber: "asc" },
    select: roundScheduleSelect,
  });
}

const memberObligationSelect = {
  id: true,
  expectedAmount: true,
  currency: true,
  dueDate: true,
  round: { select: { roundNumber: true } },
} satisfies Prisma.ContributionObligationSelect;

export type MemberObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof memberObligationSelect;
}>;

/**
 * This member's own obligations only -- never accepts or returns another
 * member's obligation rows. Ordered by the round's roundNumber (not the
 * obligation's own dueDate column) for explicit, deterministic ordering
 * independent of how due dates happen to be computed.
 */
export function findMemberObligations(circleId: string, memberId: string) {
  return prisma.contributionObligation.findMany({
    where: { circleId, memberId },
    orderBy: { round: { roundNumber: "asc" } },
    select: memberObligationSelect,
  });
}

export type ConfirmedPaymentSum = {
  readonly obligationId: string;
  readonly confirmedAmount: Prisma.Decimal;
};

/**
 * Batched by design: callers pass every obligationId they need a confirmed
 * total for and get back one row per obligation that has at least one
 * CONFIRMED payment, in a single grouped query -- never one query per
 * obligation. RECORDED and REJECTED payments are excluded by the `where`
 * clause itself, not filtered out after the fact.
 */
export async function findConfirmedPaymentSums(
  obligationIds: readonly string[],
): Promise<ConfirmedPaymentSum[]> {
  if (obligationIds.length === 0) return [];

  const grouped = await prisma.contributionPayment.groupBy({
    by: ["obligationId"],
    where: { obligationId: { in: [...obligationIds] }, status: "CONFIRMED" },
    _sum: { amount: true },
  });

  return grouped.map((row) => ({
    obligationId: row.obligationId,
    confirmedAmount: row._sum.amount ?? new Prisma.Decimal(0),
  }));
}

const roundObligationSelect = {
  id: true,
  expectedAmount: true,
} satisfies Prisma.ContributionObligationSelect;

export type RoundObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof roundObligationSelect;
}>;

/**
 * Every obligation for one round, across every member -- used only to
 * compute the circle-wide aggregate progress count. Deliberately selects
 * neither memberId nor any member-identifying field: the caller can count
 * how many obligations are met, never which member's.
 */
export function findObligationsForRound(roundId: string) {
  return prisma.contributionObligation.findMany({
    where: { roundId },
    select: roundObligationSelect,
  });
}

const memberPayoutSelect = {
  amount: true,
  status: true,
  recordedAt: true,
  confirmedAt: true,
  disputedAt: true,
} satisfies Prisma.PayoutSelect;

export type MemberPayoutRecord = Prisma.PayoutGetPayload<{
  select: typeof memberPayoutSelect;
}>;

/**
 * A true 1:1 lookup via the schema's own `@@unique([roundId])` constraint --
 * not a list, and never paginated. Returns null when no Payout row has been
 * recorded for that round yet, which the service layer must treat as a
 * first-class "not yet recorded" state, not an error.
 */
export function findPayoutForRound(roundId: string) {
  return prisma.payout.findUnique({
    where: { roundId },
    select: memberPayoutSelect,
  });
}
