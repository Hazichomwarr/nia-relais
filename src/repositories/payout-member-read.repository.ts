import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only, member-scoped. No transaction, no row lock, no mutation --
// same posture as circle-member-dashboard.repository.ts (7H.2), which
// this file is a dedicated, separate sibling of rather than an extension
// of (see payout-member-read.service.ts's own module comment for why: the
// dashboard's own round query fetches EVERY round for the circle, because
// it needs the full schedule for roundSchedule/currentRound/nextRound;
// this read needs the opposite shape -- ONLY the caller's own recipient
// round(s), filtered at the database layer, never fetched broadly and
// narrowed in application code).
//
// This is also a DIFFERENT audience than
// payout-owner-read.repository.ts (7K.7) -- that file selects owner-only
// fields (memberCode, full actor provenance); this one selects strictly
// less, since a member never needs their own memberCode/displayName
// echoed back, and never needs any actor id at all (7K.8 ticket section
// 10: "the member needs 'what was recorded for my payout', not 'which
// internal User row wrote it'").

const memberPayoutsCircleSelect = {
  id: true,
  name: true,
  currency: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type MemberPayoutsCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof memberPayoutsCircleSelect;
}>;

export function findCircleForMemberPayouts(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: memberPayoutsCircleSelect,
  });
}

const memberPayoutsMemberSelect = {
  id: true,
  circleId: true,
  status: true,
} satisfies Prisma.CircleMemberSelect;

export type MemberPayoutsMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof memberPayoutsMemberSelect;
}>;

/**
 * Scoped by the (id, circleId) compound unique key -- identical shape and
 * rationale to circle-member-dashboard.repository.ts's own
 * findMemberSummary: a real memberId belonging to a DIFFERENT circle
 * resolves to null here, identically to a memberId that doesn't exist at
 * all, so there is no separate "does this member belong to this circle"
 * check needed anywhere else.
 */
export function findMemberForPayouts(circleId: string, memberId: string) {
  return prisma.circleMember.findUnique({
    where: { id_circleId: { id: memberId, circleId } },
    select: memberPayoutsMemberSelect,
  });
}

const memberPayoutsRoundSelect = {
  id: true,
  roundNumber: true,
  dueDate: true,
  status: true,
  recipientId: true,
} satisfies Prisma.PayoutRoundSelect;

export type MemberPayoutsRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof memberPayoutsRoundSelect;
}>;

/**
 * THE critical privacy filter (7K.8 ticket section 4/9): every round
 * WHERE circleId AND recipientId = memberId, filtered at the database
 * layer -- never "fetch every round for the circle, then keep only mine"
 * in application code. `PayoutRound.@@unique([circleId, recipientId])`
 * structurally guarantees at most one row can ever match, but this query
 * does not hard-code that as a single-record lookup (e.g. a compound-key
 * findUnique) -- it stays a plain, future-safe findMany filtered exactly
 * by the two columns that define recipient authority, so it remains
 * correct even if that invariant were ever relaxed. No other member's
 * round -- regardless of that round's own status, or whether it has a
 * RECORDED/CONFIRMED/DISPUTED payout -- can ever be returned by this
 * query, for any input.
 */
export function findRecipientRoundsForMember(circleId: string, memberId: string) {
  return prisma.payoutRound.findMany({
    where: { circleId, recipientId: memberId },
    orderBy: { roundNumber: "asc" },
    select: memberPayoutsRoundSelect,
  });
}

const memberPayoutsObligationSelect = {
  id: true,
  roundId: true,
  expectedAmount: true,
  currency: true,
} satisfies Prisma.ContributionObligationSelect;

export type MemberPayoutsObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof memberPayoutsObligationSelect;
}>;

/**
 * Every obligation for a bounded, caller-supplied set of round ids (the
 * caller's own recipient round(s) only -- see findRecipientRoundsForMember
 * above) -- one batched query, never one per round. Deliberately selects
 * no memberId: the expected-payout sum needs every member's obligation
 * for that round (the round's whole pot), never scoped to the caller's
 * own obligation alone, but nothing here identifies which obligation
 * belongs to which OTHER member.
 */
export function findObligationsForRecipientRounds(circleId: string, roundIds: readonly string[]) {
  if (roundIds.length === 0) return Promise.resolve([] as MemberPayoutsObligationRecord[]);

  return prisma.contributionObligation.findMany({
    where: { circleId, roundId: { in: [...roundIds] } },
    select: memberPayoutsObligationSelect,
  });
}

const memberPayoutsPayoutSelect = {
  id: true,
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

export type MemberPayoutsPayoutRecord = Prisma.PayoutGetPayload<{
  select: typeof memberPayoutsPayoutSelect;
}>;

/**
 * Every Payout row for a bounded, caller-supplied set of round ids (again,
 * the caller's own recipient round(s) only) -- one batched query. Selects
 * recordedById/confirmedByMemberId/disputedByMemberId so the SERVICE can
 * verify internal provenance integrity (7K.8 ticket section 8); none of
 * the three is ever included in this read's own serialized output (see
 * the service's own comment) -- selected to be checked, not to be shown.
 */
export function findPayoutsForRecipientRounds(circleId: string, roundIds: readonly string[]) {
  if (roundIds.length === 0) return Promise.resolve([] as MemberPayoutsPayoutRecord[]);

  return prisma.payout.findMany({
    where: { circleId, roundId: { in: [...roundIds] } },
    select: memberPayoutsPayoutSelect,
  });
}
