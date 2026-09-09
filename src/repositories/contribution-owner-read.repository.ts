import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only, owner-scoped. No transaction, no row lock, no mutation --
// same posture as circle-active-owner.repository.ts and
// circle-draft-owner.repository.ts. This is a DIFFERENT audience than
// circle-member-dashboard.repository.ts (member-facing, deliberately
// excludes member identity from its obligation/round reads) -- per the
// 7I.6 lesson, this file does not widen that repository's selects; it
// defines its own, separately, scoped to what an OWNER may see
// (memberCode, full payment history with actor provenance).

const ownerContributionsCircleSelect = {
  id: true,
  ownerId: true,
  name: true,
  currency: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type OwnerContributionsCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof ownerContributionsCircleSelect;
}>;

export function findCircleForOwnerContributions(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: ownerContributionsCircleSelect,
  });
}

const ownerContributionsRoundSelect = {
  id: true,
  roundNumber: true,
  dueDate: true,
  status: true,
  recipient: { select: { displayName: true } },
} satisfies Prisma.PayoutRoundSelect;

export type OwnerContributionsRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof ownerContributionsRoundSelect;
}>;

/**
 * Every persisted round for the circle, ordered by roundNumber. Used both
 * to render the "all rounds" case and, when a roundId filter is supplied,
 * to verify that round actually belongs to this circle -- a foreign
 * roundId simply never appears in this result, collapsing "foreign" and
 * "nonexistent" into the identical outcome without a second query.
 */
export function findRoundsForOwnerContributions(circleId: string) {
  return prisma.payoutRound.findMany({
    where: { circleId },
    orderBy: { roundNumber: "asc" },
    select: ownerContributionsRoundSelect,
  });
}

const ownerContributionsObligationSelect = {
  id: true,
  roundId: true,
  memberId: true,
  member: { select: { displayName: true, memberCode: true } },
  expectedAmount: true,
  currency: true,
  dueDate: true,
  status: true,
  fulfilledAt: true,
} satisfies Prisma.ContributionObligationSelect;

export type OwnerContributionsObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof ownerContributionsObligationSelect;
}>;

/**
 * Every obligation for the circle (optionally narrowed to one round),
 * ordered deterministically by (roundId, id) -- never by a derived
 * accounting fact. Includes member displayName/memberCode: this is the
 * owner-only obligation read the 7J audit (section 8) identified as
 * missing, deliberately separate from
 * circle-member-dashboard.repository.ts's own member-facing
 * findMemberObligations, which excludes member identity entirely.
 */
export function findObligationsForOwnerContributions(circleId: string, roundId?: string) {
  return prisma.contributionObligation.findMany({
    where: { circleId, ...(roundId ? { roundId } : {}) },
    orderBy: [{ roundId: "asc" }, { id: "asc" }],
    select: ownerContributionsObligationSelect,
  });
}

const ownerContributionsPaymentSelect = {
  id: true,
  obligationId: true,
  amount: true,
  currency: true,
  status: true,
  clientOperationId: true,
  recordedAt: true,
  recordedById: true,
  confirmedAt: true,
  confirmedById: true,
  rejectedAt: true,
  rejectedById: true,
  rejectionReason: true,
} satisfies Prisma.ContributionPaymentSelect;

export type OwnerContributionsPaymentRecord = Prisma.ContributionPaymentGetPayload<{
  select: typeof ownerContributionsPaymentSelect;
}>;

/**
 * Every payment attempt (RECORDED, CONFIRMED, and REJECTED alike) for a
 * bounded, caller-supplied set of obligation ids -- one batched query,
 * never one query per obligation. Ordered by (recordedAt, id), a stable,
 * deterministic tiebreak that survives two payments recorded in the same
 * millisecond. This is the full historical ledger, including rejected
 * attempts, which the service layer must never collapse to only the
 * latest row per obligation (7J.5 section 5).
 */
export function findPaymentsForOwnerContributions(circleId: string, obligationIds: readonly string[]) {
  if (obligationIds.length === 0) return Promise.resolve([] as OwnerContributionsPaymentRecord[]);

  return prisma.contributionPayment.findMany({
    where: { circleId, obligationId: { in: [...obligationIds] } },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: ownerContributionsPaymentSelect,
  });
}
