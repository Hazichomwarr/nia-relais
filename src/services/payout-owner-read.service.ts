import "server-only";

import { toMoney } from "@/src/domain/contribution-accounting";
import {
  amountMatchesExpectedPayout,
  computeExpectedPayoutAmount,
  type ExpectedPayoutAmount,
} from "@/src/domain/payout-accounting";
import {
  findCircleForOwnerPayouts,
  findObligationsForOwnerPayouts,
  findPayoutsForOwnerPayouts,
  findRoundsForOwnerPayouts,
  type OwnerPayoutsObligationRecord,
  type OwnerPayoutsPayoutRecord,
  type OwnerPayoutsRoundRecord,
} from "@/src/repositories/payout-owner-read.repository";

// Read-only owner-facing SUSU payout read model (7K.7). Answers "what is
// this circle's persisted payout history, round by round" -- the payout
// counterpart to contribution-owner-read.service.ts (7J.5). No mutation
// anywhere in this file -- see payout-recording/confirmation/dispute
// .service.ts for the writers this read model observes.
//
// Historical authority: every fact returned here comes straight from the
// persisted PayoutRound/Payout rows -- recipientId (never re-derived from
// "whichever member currently has payoutOrder=N"), dueDate/roundNumber/
// status (frozen at activation, read verbatim), and the payout's own
// recording/confirmation/dispute provenance (never rewritten for
// display -- a DISPUTED payout is shown as DISPUTED, never softened to
// "pending correction"). Expected payout amount is recomputed fresh from
// frozen ContributionObligation history via the SAME domain function the
// write-side services use (computeExpectedPayoutAmount), never from the
// live member cohort or the circle's current contributionAmount.
//
// Lifecycle boundary: unlike getActiveCircleSummaryForOwner (7I.6) and
// getOwnerCircleContributions (7J.5), which are both explicitly
// ACTIVE-only ("a future ticket" language in 7I.6's own comment), this
// read is intentionally available for ACTIVE, COMPLETED, and ARCHIVED
// circles. Payout history is permanent accounting fact once recorded --
// it does not stop being true when a circle later completes or is
// archived, exactly mirroring confirmPayout/disputePayout's own frozen
// rule that a legitimate recipient decision (and its replay) must remain
// readable/actionable past ACTIVE (7K.4/7K.5). A DRAFT circle has no
// PayoutRound/ContributionObligation rows at all (both are created only
// at activation), so it is rejected here exactly as it is rejected by
// every other owner read -- there is nothing yet to show. A CANCELLED
// circle never activates either, so the same rejection applies to it.

export class OwnerPayoutsCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "OwnerPayoutsCircleNotFoundError";
  }
}

export class OwnerPayoutsAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to view payouts for this circle.");
    this.name = "OwnerPayoutsAuthorizationError";
  }
}

export class OwnerPayoutsCircleNotEligibleError extends Error {
  constructor() {
    super("Payout details are only available once a circle has been activated.");
    this.name = "OwnerPayoutsCircleNotEligibleError";
  }
}

export class OwnerPayoutsIntegrityError extends Error {
  constructor() {
    super("This circle's persisted payout history is inconsistent and cannot be safely displayed.");
    this.name = "OwnerPayoutsIntegrityError";
  }
}

// Re-exported so a caller can catch the whole owner-payout-read error
// surface from this one module without also needing to import the domain
// layer -- unchanged from the write-side services' own identical
// re-export pattern.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

const ELIGIBLE_CIRCLE_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
type EligibleCircleStatus = (typeof ELIGIBLE_CIRCLE_STATUSES)[number];

export type OwnerPayoutsCircleResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly status: EligibleCircleStatus;
};

export type OwnerPayoutsRecipientResult = {
  readonly memberId: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly payoutOrder: number;
};

export type OwnerPayoutsExpectedResult = {
  readonly amount: string;
  readonly currency: string;
};

export type OwnerPayoutsPayoutResult = {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: "RECORDED" | "CONFIRMED" | "DISPUTED";
  readonly clientOperationId: string;
  readonly recordedAt: string;
  readonly recordedById: string;
  readonly confirmedAt: string | null;
  readonly confirmedByMemberId: string | null;
  readonly disputedAt: string | null;
  readonly disputedByMemberId: string | null;
  readonly disputeReason: string | null;
};

export type OwnerPayoutsRoundResult = {
  readonly id: string;
  readonly roundNumber: number;
  readonly dueDate: string;
  readonly status: string;
  readonly recipient: OwnerPayoutsRecipientResult;
  readonly expectedPayout: OwnerPayoutsExpectedResult;
  readonly payout: OwnerPayoutsPayoutResult | null;
};

export type OwnerCirclePayoutsSummary = {
  readonly totalRounds: number;
  readonly recordedCount: number;
  readonly confirmedCount: number;
  readonly disputedCount: number;
  readonly unrecordedCount: number;
};

export type OwnerCirclePayoutsResult = {
  readonly circle: OwnerPayoutsCircleResult;
  readonly rounds: readonly OwnerPayoutsRoundResult[];
  readonly summary: OwnerCirclePayoutsSummary;
};

function isEligibleCircleStatus(status: string): status is EligibleCircleStatus {
  return (ELIGIBLE_CIRCLE_STATUSES as readonly string[]).includes(status);
}

function serializeExpectedPayout(expected: ExpectedPayoutAmount): OwnerPayoutsExpectedResult {
  return { amount: toMoney(expected.amount), currency: expected.currency };
}

function serializePayout(payout: OwnerPayoutsPayoutRecord): OwnerPayoutsPayoutResult {
  return {
    id: payout.id,
    amount: toMoney(payout.amount),
    currency: payout.currency,
    status: payout.status,
    clientOperationId: payout.clientOperationId,
    recordedAt: payout.recordedAt.toISOString(),
    recordedById: payout.recordedById,
    confirmedAt: payout.confirmedAt?.toISOString() ?? null,
    confirmedByMemberId: payout.confirmedByMemberId,
    disputedAt: payout.disputedAt?.toISOString() ?? null,
    disputedByMemberId: payout.disputedByMemberId,
    disputeReason: payout.disputeReason,
  };
}

/**
 * Read-time integrity of one persisted Payout row against its own round
 * (7K.7 ticket section 8) -- never repaired, only refused. The caller
 * already knows payout.roundId === round.id (this function is only ever
 * invoked with a payout already grouped under its own round) and
 * payout.circleId === circle.id (structurally guaranteed by the
 * repository's own circleId-scoped query), so neither is re-checked here.
 */
function assertPayoutIntegrity(
  payout: OwnerPayoutsPayoutRecord,
  round: OwnerPayoutsRoundRecord,
  expected: ExpectedPayoutAmount,
): void {
  if (payout.currency !== expected.currency || !amountMatchesExpectedPayout(payout.amount, expected.amount)) {
    throw new OwnerPayoutsIntegrityError();
  }
  if (payout.recordedById.length === 0) {
    throw new OwnerPayoutsIntegrityError();
  }

  if (payout.status === "RECORDED") {
    if (
      payout.confirmedAt !== null ||
      payout.confirmedByMemberId !== null ||
      payout.disputedAt !== null ||
      payout.disputedByMemberId !== null ||
      payout.disputeReason !== null
    ) {
      throw new OwnerPayoutsIntegrityError();
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
      throw new OwnerPayoutsIntegrityError();
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
      throw new OwnerPayoutsIntegrityError();
    }
    return;
  }

  // A persisted status this contract does not know at all.
  throw new OwnerPayoutsIntegrityError();
}

/**
 * Reads the owner-facing payout history for one persisted circle: every
 * round's frozen identity/recipient/expected-payout terms, plus its one
 * permanent Payout row if one has been recorded. Available for ACTIVE,
 * COMPLETED, and ARCHIVED circles (see module comment); a DRAFT or
 * CANCELLED circle is rejected with OwnerPayoutsCircleNotEligibleError,
 * since neither PayoutRound nor ContributionObligation rows exist before
 * activation.
 *
 * Query-bounded: exactly four queries regardless of round count --
 * circle, rounds (with their recipient joined), every obligation for the
 * circle, and every payout for the circle. No per-round or per-member
 * loop queries the database again.
 */
export async function getOwnerCirclePayouts(params: {
  ownerId: string;
  circleId: string;
}): Promise<OwnerCirclePayoutsResult> {
  const { ownerId, circleId } = params;

  const circle = await findCircleForOwnerPayouts(circleId);
  if (!circle) throw new OwnerPayoutsCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new OwnerPayoutsAuthorizationError();
  if (!isEligibleCircleStatus(circle.status)) throw new OwnerPayoutsCircleNotEligibleError();

  const [rounds, obligations, payouts] = await Promise.all([
    findRoundsForOwnerPayouts(circleId),
    findObligationsForOwnerPayouts(circleId),
    findPayoutsForOwnerPayouts(circleId),
  ]);

  const obligationsByRoundId = new Map<string, OwnerPayoutsObligationRecord[]>();
  for (const obligation of obligations) {
    const existing = obligationsByRoundId.get(obligation.roundId);
    if (existing) {
      existing.push(obligation);
    } else {
      obligationsByRoundId.set(obligation.roundId, [obligation]);
    }
  }

  const payoutByRoundId = new Map<string, OwnerPayoutsPayoutRecord>();
  for (const payout of payouts) {
    payoutByRoundId.set(payout.roundId, payout);
  }

  let recordedCount = 0;
  let confirmedCount = 0;
  let disputedCount = 0;
  let unrecordedCount = 0;

  const roundResults: OwnerPayoutsRoundResult[] = rounds.map((round) => {
    // Every round has at least one obligation per member, always
    // (activation's own invariant, re-verified independently on every
    // subsequent circle read by assertActivatedRotationIntegrity) -- an
    // empty or currency-inconsistent set here is a genuine corruption this
    // read must refuse to paper over, exactly like the write-side
    // services' own identical call to this function.
    const expected = computeExpectedPayoutAmount(obligationsByRoundId.get(round.id) ?? []);

    const payout = payoutByRoundId.get(round.id);
    if (payout) {
      assertPayoutIntegrity(payout, round, expected);
      if (payout.status === "RECORDED") recordedCount += 1;
      else if (payout.status === "CONFIRMED") confirmedCount += 1;
      else if (payout.status === "DISPUTED") disputedCount += 1;
    } else {
      unrecordedCount += 1;
    }

    return {
      id: round.id,
      roundNumber: round.roundNumber,
      dueDate: round.dueDate.toISOString(),
      status: round.status,
      recipient: {
        memberId: round.recipient.id,
        displayName: round.recipient.displayName,
        memberCode: round.recipient.memberCode,
        // Every persisted round recipient has a non-null payoutOrder,
        // frozen at activation and never cleared afterward (identical
        // fallback rationale to getActiveCircleSummaryForOwner's own).
        payoutOrder: round.recipient.payoutOrder ?? 0,
      },
      expectedPayout: serializeExpectedPayout(expected),
      payout: payout ? serializePayout(payout) : null,
    };
  });

  return {
    circle: { id: circle.id, name: circle.name, currency: circle.currency, status: circle.status },
    rounds: roundResults,
    summary: {
      totalRounds: rounds.length,
      recordedCount,
      confirmedCount,
      disputedCount,
      unrecordedCount,
    },
  };
}
