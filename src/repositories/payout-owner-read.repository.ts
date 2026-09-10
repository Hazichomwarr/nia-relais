import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only, owner-scoped. No transaction, no row lock, no mutation --
// same posture as circle-active-owner.repository.ts and
// contribution-owner-read.repository.ts. This is a DIFFERENT audience
// than circle-member-dashboard.repository.ts (member-facing, deliberately
// excludes member identity/actor provenance from its own reads) -- per
// the 7I.6/7J.5 lesson, this file does not widen that repository's
// selects; it defines its own, separately, scoped to what an OWNER may
// see (memberCode, payoutOrder, full payout provenance including actor
// ids).

const ownerPayoutsCircleSelect = {
  id: true,
  ownerId: true,
  name: true,
  currency: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type OwnerPayoutsCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof ownerPayoutsCircleSelect;
}>;

export function findCircleForOwnerPayouts(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: ownerPayoutsCircleSelect,
  });
}

const ownerPayoutsRoundSelect = {
  id: true,
  roundNumber: true,
  dueDate: true,
  status: true,
  recipientId: true,
  recipient: {
    select: {
      id: true,
      displayName: true,
      memberCode: true,
      payoutOrder: true,
    },
  },
} satisfies Prisma.PayoutRoundSelect;

export type OwnerPayoutsRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof ownerPayoutsRoundSelect;
}>;

/**
 * Every persisted round for the circle, ordered by roundNumber -- straight
 * from the PayoutRound row's own recipientId/dueDate/status, never
 * recomputed from current member order, today's date, or circle
 * frequency. recipientId is selected alongside the joined recipient
 * relation deliberately: the relation gives display fields, but
 * recipientId itself remains the field integrity checks compare against
 * (never the relation's own id, though the two are structurally
 * guaranteed identical by the compound FK).
 */
export function findRoundsForOwnerPayouts(circleId: string) {
  return prisma.payoutRound.findMany({
    where: { circleId },
    orderBy: { roundNumber: "asc" },
    select: ownerPayoutsRoundSelect,
  });
}

const ownerPayoutsObligationSelect = {
  id: true,
  roundId: true,
  expectedAmount: true,
  currency: true,
} satisfies Prisma.ContributionObligationSelect;

export type OwnerPayoutsObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof ownerPayoutsObligationSelect;
}>;

/**
 * Every obligation for the circle, across every round -- one bounded
 * query, never one per round. The service groups these by roundId itself
 * to compute each round's authoritative expected payout
 * (computeExpectedPayoutAmount); no member identity is selected here, this
 * read only ever needs the frozen amount/currency terms.
 */
export function findObligationsForOwnerPayouts(circleId: string) {
  return prisma.contributionObligation.findMany({
    where: { circleId },
    orderBy: [{ roundId: "asc" }, { id: "asc" }],
    select: ownerPayoutsObligationSelect,
  });
}

const ownerPayoutsPayoutSelect = {
  id: true,
  roundId: true,
  amount: true,
  currency: true,
  status: true,
  clientOperationId: true,
  recordedAt: true,
  recordedById: true,
  confirmedAt: true,
  confirmedByMemberId: true,
  disputedAt: true,
  disputedByMemberId: true,
  disputeReason: true,
} satisfies Prisma.PayoutSelect;

export type OwnerPayoutsPayoutRecord = Prisma.PayoutGetPayload<{
  select: typeof ownerPayoutsPayoutSelect;
}>;

/**
 * Every persisted Payout row for the circle -- one bounded query, never
 * one per round. Because Payout.@@unique([roundId]) is a full (not
 * partial) unique index, this returns at most one row per round: zero
 * rows for a round means unrecorded, one row is that round's permanent,
 * terminal-or-RECORDED payout history. The service groups these by
 * roundId to pair each with its round.
 */
export function findPayoutsForOwnerPayouts(circleId: string) {
  return prisma.payout.findMany({
    where: { circleId },
    select: ownerPayoutsPayoutSelect,
  });
}
