import "server-only";

import { toMoney } from "@/src/domain/contribution-accounting";
import {
  amountMatchesExpectedPayout,
  computeExpectedPayoutAmount,
  type ExpectedPayoutAmount,
} from "@/src/domain/payout-accounting";
import {
  findCircleForMemberPayouts,
  findMemberForPayouts,
  findObligationsForRecipientRounds,
  findPayoutsForRecipientRounds,
  findRecipientRoundsForMember,
  type MemberPayoutsObligationRecord,
  type MemberPayoutsPayoutRecord,
  type MemberPayoutsRoundRecord,
} from "@/src/repositories/payout-member-read.repository";

// Read-only member-facing SUSU payout read model (7K.8). Answers "what is
// MY OWN recipient round's payout history" for the trusted, already-
// authenticated caller -- never any other member's. No mutation anywhere
// in this file -- see payout-recording/confirmation/dispute.service.ts
// for the writers this read model observes.
//
// This is a NEW, separate service/repository rather than an extension of
// circle-member-dashboard.service.ts (7H.2), even though that service
// already returns a minimal `payout` field today. Two structural reasons,
// not a style preference:
//
//  1. The dashboard's existing recipient-round resolution
//     (`rounds.find((round) => round.recipientId === input.memberId)`) is
//     APPLICATION-CODE filtering over EVERY round the circle has (it must
//     fetch them all, because roundSchedule/currentRound/nextRound need
//     the full schedule). 7K.8 ticket section 4 makes the database-layer
//     WHERE circleId AND recipientId = memberId filter a hard, explicit
//     requirement for a dedicated payout read -- retrofitting that
//     constraint onto the dashboard's existing all-rounds query would
//     either break roundSchedule or require fetching rounds twice with
//     two different filters inside the same service, which is exactly
//     the "unnecessary coupling" section 12 says to avoid.
//  2. The dashboard's existing payout field is deliberately minimal
//     (amount/status/recordedAt/confirmedAt/disputedAt only -- no
//     disputeReason, no expectedPayout) -- the 7K audit's own §14 already
//     flagged disputeReason as a genuinely NEW addition needed once a
//     dispute action exists (7K.5), which it now does. Widening the
//     dashboard's shared read model to add it risks a second, subtly
//     different definition of "my payout" living in two places; this
//     service is instead the ONE place that answers that question in
//     detail, and a future dashboard revision can choose to call it
//     rather than duplicate it further.
//
// The dashboard's own existing `payout` field, its own privacy behavior,
// and every one of its own tests are completely untouched by this
// ticket -- see circle-member-dashboard.service.ts (unmodified).
//
// Privacy is enforced at the DATA layer, not by this service's own
// application logic: findRecipientRoundsForMember's own WHERE clause is
// the sole reason no other member's round can ever appear here (7K.8
// ticket section 9) -- there is no in-memory filter step in this file
// that could be forgotten or subtly wrong.

const ELIGIBLE_CIRCLE_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
type EligibleCircleStatus = (typeof ELIGIBLE_CIRCLE_STATUSES)[number];

function isEligibleCircleStatus(status: string): status is EligibleCircleStatus {
  return (ELIGIBLE_CIRCLE_STATUSES as readonly string[]).includes(status);
}

export class MemberPayoutsCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "MemberPayoutsCircleNotFoundError";
  }
}

export class MemberPayoutsCircleNotEligibleError extends Error {
  constructor() {
    super("This circle's current state does not permit a member payout read.");
    this.name = "MemberPayoutsCircleNotEligibleError";
  }
}

export class MemberPayoutsMemberNotFoundError extends Error {
  constructor() {
    super("Member not found for this circle.");
    this.name = "MemberPayoutsMemberNotFoundError";
  }
}

export class MemberPayoutsMemberNotActiveError extends Error {
  constructor() {
    super("This member is not active.");
    this.name = "MemberPayoutsMemberNotActiveError";
  }
}

export class MemberPayoutsIntegrityError extends Error {
  constructor() {
    super("This payout's persisted history is inconsistent and cannot be safely displayed.");
    this.name = "MemberPayoutsIntegrityError";
  }
}

// Re-exported so a caller can catch the whole member-payout-read error
// surface from this one module without also needing to import the domain
// layer -- unchanged from every other payout service's own identical
// re-export pattern.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type MemberPayoutsCircleResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
};

export type MemberPayoutsExpectedResult = {
  readonly amount: string;
  readonly currency: string;
};

// Deliberately narrower than payout-owner-read.service.ts's own
// OwnerPayoutsPayoutResult (7K.7): no id-of-actor field of any kind
// (recordedById/confirmedByMemberId/disputedByMemberId), no
// clientOperationId. The member already knows they are the recipient;
// an actor id adds no value to V1 member UI (7K.8 ticket section 2/10).
export type MemberPayoutsPayoutResult = {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: "RECORDED" | "CONFIRMED" | "DISPUTED";
  readonly recordedAt: string;
  readonly confirmedAt: string | null;
  readonly disputedAt: string | null;
  readonly disputeReason: string | null;
};

export type MemberPayoutsRecipientRoundResult = {
  readonly id: string;
  readonly roundNumber: number;
  readonly dueDate: string;
  readonly status: string;
  readonly expectedPayout: MemberPayoutsExpectedResult;
  readonly payout: MemberPayoutsPayoutResult | null;
};

export type MemberCirclePayoutsResult = {
  readonly circle: MemberPayoutsCircleResult;
  readonly recipientRounds: readonly MemberPayoutsRecipientRoundResult[];
};

function serializeExpectedPayout(expected: ExpectedPayoutAmount): MemberPayoutsExpectedResult {
  return { amount: toMoney(expected.amount), currency: expected.currency };
}

function serializePayout(payout: MemberPayoutsPayoutRecord): MemberPayoutsPayoutResult {
  return {
    id: payout.id,
    amount: toMoney(payout.amount),
    currency: payout.currency,
    status: payout.status,
    recordedAt: payout.recordedAt.toISOString(),
    confirmedAt: payout.confirmedAt?.toISOString() ?? null,
    disputedAt: payout.disputedAt?.toISOString() ?? null,
    disputeReason: payout.disputeReason,
  };
}

/**
 * Read-time integrity of one persisted Payout row against its own round
 * (7K.8 ticket section 8) -- identical rule set to
 * payout-owner-read.service.ts's own assertPayoutIntegrity, reused as
 * logic (not imported, since the two modules' payout record types differ
 * by which fields they select) rather than duplicated by accident. Never
 * repaired, only refused. The caller already knows payout.roundId ===
 * round.id (invoked only for a payout already grouped under its own
 * round) and payout.circleId === circle.id (structurally guaranteed by
 * the repository's own circleId-scoped query); neither is re-checked
 * here. Critically, round.recipientId here is ALREADY known to equal the
 * trusted memberId (that equality is exactly what
 * findRecipientRoundsForMember's own WHERE clause guarantees), so
 * checking confirmedByMemberId/disputedByMemberId against
 * round.recipientId is equivalent to checking them against the caller's
 * own identity -- the ticket's "=== memberId / round recipient" phrasing
 * describes one and the same check here, not two.
 */
function assertPayoutIntegrity(
  payout: MemberPayoutsPayoutRecord,
  round: MemberPayoutsRoundRecord,
  expected: ExpectedPayoutAmount,
): void {
  if (payout.currency !== expected.currency || !amountMatchesExpectedPayout(payout.amount, expected.amount)) {
    throw new MemberPayoutsIntegrityError();
  }
  if (payout.recordedById.length === 0) {
    throw new MemberPayoutsIntegrityError();
  }

  if (payout.status === "RECORDED") {
    if (
      payout.confirmedAt !== null ||
      payout.confirmedByMemberId !== null ||
      payout.disputedAt !== null ||
      payout.disputedByMemberId !== null ||
      payout.disputeReason !== null
    ) {
      throw new MemberPayoutsIntegrityError();
    }
    return;
  }

  if (payout.status === "CONFIRMED") {
    if (
      payout.confirmedAt === null ||
      payout.confirmedByMemberId === null ||
      payout.confirmedByMemberId !== round.recipientId ||
      payout.disputedAt !== null ||
      payout.disputedByMemberId !== null ||
      payout.disputeReason !== null
    ) {
      throw new MemberPayoutsIntegrityError();
    }
    return;
  }

  if (payout.status === "DISPUTED") {
    if (
      payout.disputedAt === null ||
      payout.disputedByMemberId === null ||
      payout.disputeReason === null ||
      payout.disputedByMemberId !== round.recipientId ||
      payout.confirmedAt !== null ||
      payout.confirmedByMemberId !== null
    ) {
      throw new MemberPayoutsIntegrityError();
    }
    return;
  }

  // A persisted status this contract does not know at all.
  throw new MemberPayoutsIntegrityError();
}

/**
 * Reads the trusted caller's OWN payout history for one persisted circle:
 * their own recipient round(s) only -- structurally impossible to
 * include any other member's round, since findRecipientRoundsForMember's
 * own WHERE clause is the sole source of this data. Available for
 * ACTIVE, COMPLETED, and ARCHIVED circles -- the same eligible-status set
 * `requireCircleMember`/`getCircleMemberDashboard` already use (7K.8
 * ticket section 3); a DRAFT circle is rejected because no member session
 * can exist for a circle that has never activated (no PayoutRound/
 * ContributionObligation rows exist before activation either).
 *
 * Query-bounded: circle, member, and recipient-round lookups run in
 * parallel (three queries), followed by obligation/payout lookups scoped
 * to that bounded round-id set (at most one, per
 * PayoutRound.@@unique([circleId, recipientId])) also run in parallel --
 * five queries total in the worst case, none inside a loop.
 */
export async function getCircleMemberPayouts(input: {
  circleId: string;
  memberId: string;
}): Promise<MemberCirclePayoutsResult> {
  const { circleId, memberId } = input;

  const [circle, member, recipientRounds] = await Promise.all([
    findCircleForMemberPayouts(circleId),
    findMemberForPayouts(circleId, memberId),
    findRecipientRoundsForMember(circleId, memberId),
  ]);

  if (!circle) throw new MemberPayoutsCircleNotFoundError();
  if (!isEligibleCircleStatus(circle.status)) throw new MemberPayoutsCircleNotEligibleError();
  if (!member) throw new MemberPayoutsMemberNotFoundError();
  if (member.status !== "ACTIVE") throw new MemberPayoutsMemberNotActiveError();

  const roundIds = recipientRounds.map((round) => round.id);
  const [obligations, payouts] = await Promise.all([
    findObligationsForRecipientRounds(circleId, roundIds),
    findPayoutsForRecipientRounds(circleId, roundIds),
  ]);

  const obligationsByRoundId = new Map<string, MemberPayoutsObligationRecord[]>();
  for (const obligation of obligations) {
    const existing = obligationsByRoundId.get(obligation.roundId);
    if (existing) {
      existing.push(obligation);
    } else {
      obligationsByRoundId.set(obligation.roundId, [obligation]);
    }
  }

  const payoutByRoundId = new Map<string, MemberPayoutsPayoutRecord>();
  for (const payout of payouts) {
    payoutByRoundId.set(payout.roundId, payout);
  }

  const roundResults: MemberPayoutsRecipientRoundResult[] = recipientRounds.map((round) => {
    const expected = computeExpectedPayoutAmount(obligationsByRoundId.get(round.id) ?? []);

    const payout = payoutByRoundId.get(round.id);
    if (payout) assertPayoutIntegrity(payout, round, expected);

    return {
      id: round.id,
      roundNumber: round.roundNumber,
      dueDate: round.dueDate.toISOString(),
      status: round.status,
      expectedPayout: serializeExpectedPayout(expected),
      payout: payout ? serializePayout(payout) : null,
    };
  });

  return {
    circle: { id: circle.id, name: circle.name, currency: circle.currency, status: circle.status },
    recipientRounds: roundResults,
  };
}
