import "server-only";

import { Prisma } from "@prisma/client";

import { computeExpectedPayoutAmount, type ExpectedPayoutAmount } from "@/src/domain/payout-accounting";
import {
  assertRotationSequenceIntegrity,
  assertRoundLifecycleStateIntegrity,
  assessContributionClosureReadiness,
  assessPayoutClosureReadiness,
  RoundLifecycleFinancialIntegrityError,
  RoundLifecycleStateIntegrityError,
} from "@/src/domain/round-lifecycle";
import {
  findCircleForRoundLifecycle,
  findConfirmedPaymentSumsForLifecycle,
  findObligationsForLifecycleRound,
  findPayoutForLifecycleRound,
  type LifecycleObligationRecord,
} from "@/src/repositories/round-lifecycle.repository";
import {
  findRoundsForOwnerRoundLifecycle,
  type OwnerRoundLifecycleRoundRecord,
} from "@/src/repositories/round-lifecycle-owner-read.repository";
import { prisma } from "@/src/prisma";

// Read-only owner-facing SUSU round-progression read model (7K.15).
// Answers "what may the owner truthfully be told about this circle's
// round-lifecycle state" -- the read-side counterpart to
// round-lifecycle.service.ts's own write-side authority (7K.13). No
// mutation anywhere in this file, no lock, no call into
// activateFirstRound/advanceRound "to check" (a dry run would mutate on
// success, which this module must never risk).
//
// Reuse, not duplication: circle/financial reads
// (findCircleForRoundLifecycle, findObligationsForLifecycleRound,
// findConfirmedPaymentSumsForLifecycle, findPayoutForLifecycleRound) and
// the lifecycle-state/financial-closure integrity predicates
// (assertRotationSequenceIntegrity, assertRoundLifecycleStateIntegrity,
// assessContributionClosureReadiness, assessPayoutClosureReadiness) are
// the EXACT SAME functions round-lifecycle.service.ts's own
// activateFirstRound/advanceRound already use for their own
// preconditions -- this module never reimplements or approximates that
// rule for display. Only one new read exists here at all
// (findRoundsForOwnerRoundLifecycle, round-lifecycle-owner-read
// .repository.ts), because the write side's own round select has no
// reason to carry the recipient's display fields an owner UI needs.
//
// Lifecycle scope: ACTIVE circles only -- a deliberate, narrower scope
// than getOwnerCirclePayouts's own ACTIVE/COMPLETED/ARCHIVED history
// read. That read answers "what permanently happened," which remains
// true forever; this read answers "what transition may happen next,"
// which is meaningless once a circle can no longer transition at all
// (COMPLETED/ARCHIVED). This mirrors getActiveCircleSummaryForOwner's own
// ACTIVE-only scope, not getOwnerCirclePayouts's permanent-history scope.
// A DRAFT circle has no PayoutRound rows at all (created only at
// activation) and a CANCELLED circle never activates either, so both are
// rejected the same way every other owner read rejects them.
//
// Corruption is never a blocker: every "not ready yet" outcome below
// (CONTRIBUTIONS_INCOMPLETE, PAYOUT_MISSING, PAYOUT_NOT_CONFIRMED,
// PAYOUT_DISPUTED) is an ordinary, waitable business state a genuine
// owner workflow produces routinely. A persisted-history contradiction
// (multiple ACTIVE rounds, a broken round sequence, a FULFILLED
// obligation with no ledger support, a CONFIRMED payout with drifted
// amount/currency/provenance, ...) is never mapped to one of those four
// blockers -- it always throws OwnerRoundLifecycleIntegrityError instead,
// so a future UI can distinguish "still waiting on normal work" from
// "saved history is internally inconsistent."

export class OwnerRoundLifecycleCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "OwnerRoundLifecycleCircleNotFoundError";
  }
}

export class OwnerRoundLifecycleAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to view this circle's round lifecycle.");
    this.name = "OwnerRoundLifecycleAuthorizationError";
  }
}

export class OwnerRoundLifecycleCircleNotEligibleError extends Error {
  constructor() {
    super("Round lifecycle details are only available for an active circle.");
    this.name = "OwnerRoundLifecycleCircleNotEligibleError";
  }
}

export class OwnerRoundLifecycleIntegrityError extends Error {
  constructor() {
    super("This circle's persisted round lifecycle history is inconsistent and cannot be safely displayed.");
    this.name = "OwnerRoundLifecycleIntegrityError";
  }
}

// Re-exported so a caller can catch the whole owner-round-lifecycle-read
// error surface from this one module without also needing to import the
// domain layer -- unchanged from every other read/write service's own
// identical re-export pattern.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type OwnerRoundLifecycleRecipientResult = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
};

export type OwnerRoundLifecycleRoundResult = {
  readonly id: string;
  readonly roundNumber: number;
  readonly recipient: OwnerRoundLifecycleRecipientResult;
  readonly dueDate: string;
  readonly status: "UPCOMING" | "ACTIVE" | "CLOSED";
};

export type OwnerRoundLifecycleBlocker =
  | "CONTRIBUTIONS_INCOMPLETE"
  | "PAYOUT_MISSING"
  | "PAYOUT_NOT_CONFIRMED"
  | "PAYOUT_DISPUTED";

export type OwnerRoundLifecycleTransitionKind =
  | "START_FIRST_ROUND"
  | "ADVANCE_TO_NEXT_ROUND"
  | "CLOSE_FINAL_ROUND"
  | "AWAIT_CIRCLE_COMPLETION";

export type OwnerRoundLifecycleProgression = {
  readonly canStartFirstRound: boolean;
  readonly canAdvanceCurrentRound: boolean;
  readonly blocker: OwnerRoundLifecycleBlocker | null;
  readonly transitionKind: OwnerRoundLifecycleTransitionKind;
};

export type OwnerRoundLifecycleResult = {
  readonly circle: { readonly id: string; readonly status: "ACTIVE" };
  readonly phase: "NOT_STARTED" | "IN_PROGRESS" | "ALL_ROUNDS_CLOSED";
  readonly totalRounds: number;
  readonly closedRounds: number;
  readonly currentRound: OwnerRoundLifecycleRoundResult | null;
  readonly nextRound: OwnerRoundLifecycleRoundResult | null;
  readonly progression: OwnerRoundLifecycleProgression;
};

function serializeRound(round: OwnerRoundLifecycleRoundRecord): OwnerRoundLifecycleRoundResult {
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    recipient: {
      id: round.recipient.id,
      displayName: round.recipient.displayName,
      memberCode: round.recipient.memberCode,
    },
    dueDate: round.dueDate.toISOString(),
    status: round.status,
  };
}

/**
 * Wraps the shared, pure round-lifecycle-state-shape validator
 * (src/domain/round-lifecycle.ts) with this service's own named integrity
 * error -- the identical function round-lifecycle.service.ts's own
 * assertLifecycleStateIntegrity calls (wrapped there as
 * RoundLifecycleIntegrityError instead), so this read and that write can
 * never silently drift into different definitions of "a coherent
 * lifecycle state."
 */
function assertLifecycleStateIntegrity(rounds: readonly OwnerRoundLifecycleRoundRecord[]): void {
  try {
    assertRotationSequenceIntegrity(rounds);
    assertRoundLifecycleStateIntegrity(rounds);
  } catch (error) {
    if (error instanceof RoundLifecycleStateIntegrityError) throw new OwnerRoundLifecycleIntegrityError();
    throw error;
  }
}

/**
 * The current ACTIVE round's financial-closure progression (7K.13
 * sections 12-13, reused unchanged via assessContributionClosureReadiness
 * / assessPayoutClosureReadiness) -- classified for DISPLAY rather than
 * thrown-and-caught for a mutation decision, but built from the exact
 * same predicate advanceRound itself evaluates under its own lock.
 * Queries only this ONE round's obligations/payments/payout -- never any
 * other round's financial history.
 */
async function assessCurrentRoundProgression(
  circleId: string,
  active: OwnerRoundLifecycleRoundRecord,
  transitionKind: "ADVANCE_TO_NEXT_ROUND" | "CLOSE_FINAL_ROUND",
): Promise<OwnerRoundLifecycleProgression> {
  const notReady = (blocker: OwnerRoundLifecycleBlocker): OwnerRoundLifecycleProgression => ({
    canStartFirstRound: false,
    canAdvanceCurrentRound: false,
    blocker,
    transitionKind,
  });

  const obligations = await findObligationsForLifecycleRound(prisma, circleId, active.id);

  let expected: ExpectedPayoutAmount;
  try {
    expected = computeExpectedPayoutAmount(obligations);
  } catch {
    throw new OwnerRoundLifecycleIntegrityError();
  }

  const confirmedSums = await findConfirmedPaymentSumsForLifecycle(
    prisma,
    obligations.map((obligation: LifecycleObligationRecord) => obligation.id),
  );
  const confirmedByObligationId = new Map(confirmedSums.map((row) => [row.obligationId, row.confirmedAmount]));

  let contributionReadiness: "READY" | "INCOMPLETE";
  try {
    contributionReadiness = assessContributionClosureReadiness(
      obligations.map((obligation) => ({
        expectedAmount: obligation.expectedAmount,
        status: obligation.status,
        fulfilledAt: obligation.fulfilledAt,
        confirmedAmount: confirmedByObligationId.get(obligation.id) ?? new Prisma.Decimal(0),
      })),
    );
  } catch (error) {
    if (error instanceof RoundLifecycleFinancialIntegrityError) throw new OwnerRoundLifecycleIntegrityError();
    throw error;
  }

  if (contributionReadiness === "INCOMPLETE") return notReady("CONTRIBUTIONS_INCOMPLETE");

  const payout = await findPayoutForLifecycleRound(prisma, circleId, active.id);

  let payoutReadiness: "MISSING" | "NOT_CONFIRMED" | "DISPUTED" | "READY";
  try {
    payoutReadiness = assessPayoutClosureReadiness(payout, active.recipientId, expected);
  } catch (error) {
    if (error instanceof RoundLifecycleFinancialIntegrityError) throw new OwnerRoundLifecycleIntegrityError();
    throw error;
  }

  if (payoutReadiness === "MISSING") return notReady("PAYOUT_MISSING");
  if (payoutReadiness === "NOT_CONFIRMED") return notReady("PAYOUT_NOT_CONFIRMED");
  if (payoutReadiness === "DISPUTED") return notReady("PAYOUT_DISPUTED");

  return { canStartFirstRound: false, canAdvanceCurrentRound: true, blocker: null, transitionKind };
}

/**
 * Reads the owner-facing round-progression state of one ACTIVE circle:
 * which phase the rotation is in, the current/next round (straight from
 * persisted PayoutRound identity/recipient/dueDate/status -- never
 * reconstructed from payoutOrder, circle.frequency, or the current date),
 * and, for a genuinely in-progress rotation, whether the current round is
 * financially ready to close and which ordinary blocker applies if not.
 *
 * Query-bounded: exactly 2 queries (circle, rounds) for NOT_STARTED and
 * ALL_ROUNDS_CLOSED; at most 5 queries (+ obligations, confirmed-payment
 * sums, payout for the ONE current round) for IN_PROGRESS -- never a
 * query per round, never a financial query for any round other than the
 * current ACTIVE one.
 */
export async function getOwnerRoundLifecycle(params: {
  ownerId: string;
  circleId: string;
}): Promise<OwnerRoundLifecycleResult> {
  const { ownerId, circleId } = params;

  const circle = await findCircleForRoundLifecycle(prisma, circleId);
  if (!circle) throw new OwnerRoundLifecycleCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new OwnerRoundLifecycleAuthorizationError();
  if (circle.status !== "ACTIVE") throw new OwnerRoundLifecycleCircleNotEligibleError();

  const rounds = await findRoundsForOwnerRoundLifecycle(circleId);
  if (rounds.length === 0) {
    // An ACTIVE circle always has its full round set created atomically at
    // activation (activateCircle's own invariant) -- zero rounds here
    // should be unreachable in practice, but "never activated" and
    // "ACTIVE with no rounds" are not the same fact, so this is refused as
    // corruption rather than misreported as NOT_STARTED.
    throw new OwnerRoundLifecycleIntegrityError();
  }
  assertLifecycleStateIntegrity(rounds);

  const totalRounds = rounds.length;
  const closedRounds = rounds.filter((round) => round.status === "CLOSED").length;
  const circleResult = { id: circle.id, status: "ACTIVE" as const };

  if (rounds.every((round) => round.status === "UPCOMING")) {
    const roundOne = rounds.find((round) => round.roundNumber === 1);
    if (!roundOne) throw new OwnerRoundLifecycleIntegrityError();
    return {
      circle: circleResult,
      phase: "NOT_STARTED",
      totalRounds,
      closedRounds,
      currentRound: null,
      nextRound: serializeRound(roundOne),
      progression: {
        canStartFirstRound: true,
        canAdvanceCurrentRound: false,
        blocker: null,
        transitionKind: "START_FIRST_ROUND",
      },
    };
  }

  if (rounds.every((round) => round.status === "CLOSED")) {
    return {
      circle: circleResult,
      phase: "ALL_ROUNDS_CLOSED",
      totalRounds,
      closedRounds,
      currentRound: null,
      nextRound: null,
      progression: {
        canStartFirstRound: false,
        canAdvanceCurrentRound: false,
        blocker: null,
        transitionKind: "AWAIT_CIRCLE_COMPLETION",
      },
    };
  }

  // IN_PROGRESS: assertLifecycleStateIntegrity above already guarantees
  // exactly one ACTIVE round exists once neither all-UPCOMING nor
  // all-CLOSED holds.
  const active = rounds.find((round) => round.status === "ACTIVE");
  if (!active) throw new OwnerRoundLifecycleIntegrityError();

  const successor = rounds.find((round) => round.roundNumber === active.roundNumber + 1) ?? null;
  const transitionKind: "ADVANCE_TO_NEXT_ROUND" | "CLOSE_FINAL_ROUND" = successor
    ? "ADVANCE_TO_NEXT_ROUND"
    : "CLOSE_FINAL_ROUND";

  const progression = await assessCurrentRoundProgression(circleId, active, transitionKind);

  return {
    circle: circleResult,
    phase: "IN_PROGRESS",
    totalRounds,
    closedRounds,
    currentRound: serializeRound(active),
    nextRound: successor ? serializeRound(successor) : null,
    progression,
  };
}
