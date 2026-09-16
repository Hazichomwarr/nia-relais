import "server-only";

import { Prisma } from "@prisma/client";

import { clampToZero, isObligationFulfilled, toMoney } from "@/src/domain/contribution-accounting";
import { selectCurrentAndNextRound } from "@/src/domain/circle-round-selection";
import {
  findCircleSummary,
  countActiveCircleMembers,
  findActiveCircleMemberNames,
  findConfirmedPaymentSums,
  findMemberObligations,
  findMemberSummary,
  findObligationsForRound,
  findPayoutForRound,
  findRoundsForCircle,
  type RoundScheduleRecord,
} from "@/src/repositories/circle-member-dashboard.repository";

// This service accepts only a trusted { circleId, memberId } pair -- it
// never reads cookies, never calls requireCircleMember itself, and never
// imports next/headers or next/navigation. Authorization is the caller's
// job (requireCircleMember, at the route/page boundary); this file's job is
// only to render a truthful, correctly-scoped, Decimal-safe read model once
// that trust has already been established. It still independently verifies
// relational integrity below rather than assuming the caller got it right.

const ELIGIBLE_CIRCLE_STATUSES = new Set(["ACTIVE", "COMPLETED", "ARCHIVED"]);

export class CircleMemberDashboardCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "CircleMemberDashboardCircleNotFoundError";
  }
}

export class CircleMemberDashboardCircleNotEligibleError extends Error {
  constructor() {
    super("This circle's current state does not permit a member dashboard.");
    this.name = "CircleMemberDashboardCircleNotEligibleError";
  }
}

export class CircleMemberDashboardMemberNotFoundError extends Error {
  constructor() {
    super("Member not found for this circle.");
    this.name = "CircleMemberDashboardMemberNotFoundError";
  }
}

export class CircleMemberDashboardMemberNotActiveError extends Error {
  constructor() {
    super("This member is not active.");
    this.name = "CircleMemberDashboardMemberNotActiveError";
  }
}


export type CircleSummaryResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly status: string;
  readonly startDate: string;
  // 9G: circle-level import context authority for the member workspace
  // banner -- identical purpose to circle-active-owner.service.ts's own
  // originKind/historicalCompletedRoundCount.
  readonly originKind: "NEW" | "IMPORTED";
  readonly historicalCompletedRoundCount: number;
};

export type MemberSummaryResult = {
  readonly displayName: string;
  readonly payoutOrder: number | null;
};

export type RoundScheduleEntry = {
  readonly roundNumber: number;
  readonly dueDate: string;
  readonly status: string;
  readonly recipientDisplayName: string;
  // 9G: presentation authority -- IMPORTED_DECLARATION means this round's
  // CLOSED status is the owner's own historical declaration, never a
  // normal NIA-managed closure.
  readonly closureBasis: "NIA_MANAGED" | "IMPORTED_DECLARATION";
};

export type MemberObligationResult = {
  readonly roundNumber: number;
  readonly dueDate: string;
  readonly expectedAmount: string;
  readonly confirmedAmount: string;
  readonly outstandingAmount: string;
  readonly fulfilled: boolean;
  // 9G: presentation authority -- IMPORTED_DECLARATION means this
  // obligation's fulfilled state is the owner's own historical
  // declaration; no real ContributionPayment backs it.
  readonly fulfillmentBasis: "NIA_CONFIRMED_LEDGER" | "IMPORTED_DECLARATION";
};

export type MemberContributionSummary = {
  readonly confirmedContributionTotal: string;
  readonly fulfilledObligationCount: number;
  readonly totalObligationCount: number;
};

export type RoundProgressResult = {
  readonly confirmedMemberCount: number;
  readonly totalMemberCount: number;
  // Computed from the selected round's persisted obligations with Decimal
  // arithmetic. This is an expected collection/payout figure only; it never
  // represents a recorded or transferred payout.
  readonly expectedPayoutAmount: string;
} | null;

export type MemberPayoutResult = {
  readonly roundNumber: number;
  readonly amount: string;
  readonly status: string;
  readonly recordedAt: string;
  readonly confirmedAt: string | null;
  readonly disputedAt: string | null;
  // 9G: presentation authority -- IMPORTED_DECLARATION means this payout's
  // CONFIRMED status is the owner's own historical declaration at import
  // time, never a real member confirmation through NIA.
  readonly confirmationBasis: "MEMBER_CONFIRMED" | "IMPORTED_DECLARATION";
} | null;

export type MemberDashboardResult = {
  readonly circle: CircleSummaryResult;
  readonly member: MemberSummaryResult;
  readonly activeMemberCount: number;
  readonly activeMemberDisplayNames: readonly string[];
  readonly roundSchedule: readonly RoundScheduleEntry[];
  readonly currentRound: RoundScheduleEntry | null;
  readonly nextRound: RoundScheduleEntry | null;
  readonly roundProgress: RoundProgressResult;
  readonly obligations: readonly MemberObligationResult[];
  readonly summary: MemberContributionSummary;
  readonly payout: MemberPayoutResult;
};

function serializeRound(round: RoundScheduleRecord): RoundScheduleEntry {
  return {
    roundNumber: round.roundNumber,
    dueDate: round.dueDate.toISOString(),
    status: round.status,
    recipientDisplayName: round.recipient.displayName,
    closureBasis: round.closureBasis,
  };
}


/**
 * Builds the read-only SUSU member dashboard for exactly one
 * (circleId, memberId) pair. Inputs are assumed to already be trusted (the
 * caller is expected to have derived them from requireCircleMember), but
 * relational integrity is still verified independently here: the circle
 * must exist and be in an eligible lifecycle state, the member must belong
 * to that exact circle (see findMemberSummary's compound-key lookup) and be
 * ACTIVE. Any failure throws a specific, internal error -- this function is
 * called from an already-authorized server context, not a public
 * authentication boundary, so (unlike validateCircleMemberSession) there is
 * no requirement to collapse these into one generic outcome.
 */
export async function getCircleMemberDashboard(input: {
  circleId: string;
  memberId: string;
}): Promise<MemberDashboardResult> {
  const [circle, member, activeMemberCount, activeMembers, rounds, obligations] = await Promise.all([
    findCircleSummary(input.circleId),
    findMemberSummary(input.circleId, input.memberId),
    countActiveCircleMembers(input.circleId),
    findActiveCircleMemberNames(input.circleId),
    findRoundsForCircle(input.circleId),
    findMemberObligations(input.circleId, input.memberId),
  ]);

  if (!circle) throw new CircleMemberDashboardCircleNotFoundError();
  if (!ELIGIBLE_CIRCLE_STATUSES.has(circle.status)) {
    throw new CircleMemberDashboardCircleNotEligibleError();
  }
  if (!member) throw new CircleMemberDashboardMemberNotFoundError();
  if (member.status !== "ACTIVE") throw new CircleMemberDashboardMemberNotActiveError();

  const { currentRound, nextRound } = selectCurrentAndNextRound(circle.status, rounds);
  const selectedRound = currentRound ?? nextRound;
  const recipientRound = rounds.find((round) => round.recipientId === input.memberId) ?? null;

  const [confirmedSumsForMember, roundObligationsForProgress, payoutRecord] = await Promise.all([
    findConfirmedPaymentSums(obligations.map((obligation) => obligation.id)),
    selectedRound ? findObligationsForRound(selectedRound.id) : Promise.resolve([]),
    recipientRound ? findPayoutForRound(recipientRound.id) : Promise.resolve(null),
  ]);

  const roundProgressConfirmedSums =
    roundObligationsForProgress.length > 0
      ? await findConfirmedPaymentSums(roundObligationsForProgress.map((obligation) => obligation.id))
      : [];

  // --- member obligations: Decimal arithmetic throughout, formatted to
  // strings only at the very end. ---
  const confirmedByObligationId = new Map(
    confirmedSumsForMember.map((row) => [row.obligationId, row.confirmedAmount]),
  );

  const obligationComputations = obligations.map((obligation) => {
    const confirmedAmount = confirmedByObligationId.get(obligation.id) ?? new Prisma.Decimal(0);
    const outstandingAmount = clampToZero(obligation.expectedAmount.minus(confirmedAmount));
    // Deliberately NOT obligation.status -- see the 7H audit and the module
    // comment above: nothing in this codebase writes ContributionObligation
    // .status to FULFILLED, so it cannot be trusted as payment truth. This
    // is computed live from the payment ledger every time.
    const fulfilled = isObligationFulfilled(confirmedAmount, obligation.expectedAmount);

    return {
      roundNumber: obligation.round.roundNumber,
      dueDate: obligation.dueDate,
      expectedAmount: obligation.expectedAmount,
      confirmedAmount,
      outstandingAmount,
      fulfilled,
      fulfillmentBasis: obligation.fulfillmentBasis,
    };
  });

  const confirmedContributionTotal = obligationComputations.reduce(
    (total, obligation) => total.plus(obligation.confirmedAmount),
    new Prisma.Decimal(0),
  );
  const fulfilledObligationCount = obligationComputations.filter((obligation) => obligation.fulfilled).length;

  const obligationResults: MemberObligationResult[] = obligationComputations.map((obligation) => ({
    roundNumber: obligation.roundNumber,
    dueDate: obligation.dueDate.toISOString(),
    expectedAmount: toMoney(obligation.expectedAmount),
    confirmedAmount: toMoney(obligation.confirmedAmount),
    outstandingAmount: toMoney(obligation.outstandingAmount),
    fulfilled: obligation.fulfilled,
    fulfillmentBasis: obligation.fulfillmentBasis,
  }));

  // --- circle-wide round progress: aggregate counts only, never a
  // per-member breakdown. ---
  let roundProgress: RoundProgressResult = null;
  if (selectedRound) {
    const confirmedByRoundObligationId = new Map(
      roundProgressConfirmedSums.map((row) => [row.obligationId, row.confirmedAmount]),
    );
    const confirmedMemberCount = roundObligationsForProgress.filter((obligation) => {
      const confirmedAmount = confirmedByRoundObligationId.get(obligation.id) ?? new Prisma.Decimal(0);
      return isObligationFulfilled(confirmedAmount, obligation.expectedAmount);
    }).length;

    const expectedPayoutAmount = roundObligationsForProgress.reduce(
      (total, obligation) => total.plus(obligation.expectedAmount),
      new Prisma.Decimal(0),
    );
    roundProgress = {
      confirmedMemberCount,
      totalMemberCount: roundObligationsForProgress.length,
      expectedPayoutAmount: toMoney(expectedPayoutAmount),
    };
  }

  // --- this member's own payout, if they are ever a recipient. ---
  // No Payout row -> "not yet recorded", represented as null, never as a
  // zero-amount or synthetic row. RECORDED is never treated as confirmed
  // receipt -- the status string is passed through verbatim, and no
  // derived "received" boolean is added.
  const payout: MemberPayoutResult =
    recipientRound && payoutRecord
      ? {
          roundNumber: recipientRound.roundNumber,
          amount: toMoney(payoutRecord.amount),
          status: payoutRecord.status,
          recordedAt: payoutRecord.recordedAt.toISOString(),
          confirmedAt: payoutRecord.confirmedAt?.toISOString() ?? null,
          disputedAt: payoutRecord.disputedAt?.toISOString() ?? null,
          confirmationBasis: payoutRecord.confirmationBasis,
        }
      : null;

  return {
    circle: {
      id: circle.id,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: toMoney(circle.contributionAmount),
      frequency: circle.frequency,
      status: circle.status,
      startDate: circle.startDate.toISOString().slice(0, 10),
      originKind: circle.originKind,
      historicalCompletedRoundCount: circle.historicalCompletedRoundCount,
    },
    member: { displayName: member.displayName, payoutOrder: member.payoutOrder },
    activeMemberCount,
    activeMemberDisplayNames: activeMembers.map((activeMember) => activeMember.displayName),
    roundSchedule: rounds.map(serializeRound),
    currentRound: currentRound ? serializeRound(currentRound) : null,
    nextRound: nextRound ? serializeRound(nextRound) : null,
    roundProgress,
    obligations: obligationResults,
    summary: {
      confirmedContributionTotal: toMoney(confirmedContributionTotal),
      fulfilledObligationCount,
      totalObligationCount: obligationComputations.length,
    },
    payout,
  };
}
