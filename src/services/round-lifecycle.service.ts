import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { computeExpectedPayoutAmount, type ExpectedPayoutAmount } from "@/src/domain/payout-accounting";
import {
  assertRotationSequenceIntegrity,
  assertRoundLifecycleStateIntegrity,
  assessContributionClosureReadiness,
  assessPayoutClosureReadiness,
  RoundLifecycleFinancialIntegrityError,
  RoundLifecycleStateIntegrityError,
} from "@/src/domain/round-lifecycle";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  activateLifecycleRound,
  closeLifecycleRound,
  findCircleForRoundLifecycle,
  findConfirmedPaymentSumsForLifecycle,
  findObligationsForLifecycleRound,
  findPayoutForLifecycleRound,
  findRoundsForLifecycle,
  type LifecycleObligationRecord,
  type LifecyclePayoutRecord,
  type LifecycleRoundRecord,
} from "@/src/repositories/round-lifecycle.repository";
import { prisma } from "@/src/prisma";

// Implements the frozen 7K.11 round-lifecycle contract
// (docs/product/susu-payout-workflow-audit.md §21): exactly two public
// operations, activateFirstRound and advanceRound -- never closeRound/
// activateNextRound as independent public operations (§21.12/§21.22),
// so a partial "current CLOSED, successor still UPCOMING" state can
// never be produced by any caller of this module.
//
// Structure mirrors every other financial writer in this codebase
// (recordPayout, confirmContribution, ...): an unlocked, fail-fast
// pre-check (ownership, then a terminal/replay short-circuit that never
// needs the lock) followed by a locked, authoritative transaction for a
// genuinely fresh transition, which re-checks everything once more under
// the SAME shared SavingsCircle lock (lockSavingsCircleForUpdate,
// unchanged, unmodified -- 7K.11 §21.19's own required lock-order
// consistency) before writing anything.
//
// This module writes ONLY PayoutRound.status/activatedAt/activatedById/
// closedAt/closedById, through the two narrow CAS functions in
// round-lifecycle.repository.ts. It never writes ContributionPayment,
// ContributionObligation, Payout, CircleMember, or any SavingsCircle
// field (including status/completedAt/completedById) -- circle
// completion remains a separate, future, unimplemented operation
// (7K.11 §21.13/§21.25), and financial mutation (contribution/payout
// recording and decisions) remains entirely ungated by anything in this
// file, exactly as 7K.11 §21.5 requires.

export class RoundLifecycleCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "RoundLifecycleCircleNotFoundError";
  }
}

export class RoundLifecycleAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to manage this circle's round lifecycle.");
    this.name = "RoundLifecycleAuthorizationError";
  }
}

export class RoundLifecycleCircleNotActiveError extends Error {
  constructor() {
    super("Round lifecycle can only be advanced for an active circle.");
    this.name = "RoundLifecycleCircleNotActiveError";
  }
}

export class RoundLifecycleRoundNotFoundError extends Error {
  constructor() {
    super("Payout round not found for this circle.");
    this.name = "RoundLifecycleRoundNotFoundError";
  }
}

export class RoundLifecycleNotCurrentError extends Error {
  constructor() {
    super("Only the circle's current ACTIVE round can be advanced.");
    this.name = "RoundLifecycleNotCurrentError";
  }
}

export class RoundLifecycleContributionsIncompleteError extends Error {
  constructor() {
    super("Not every contribution for this round has been confirmed yet.");
    this.name = "RoundLifecycleContributionsIncompleteError";
  }
}

export class RoundLifecyclePayoutMissingError extends Error {
  constructor() {
    super("No payout has been recorded for this round yet.");
    this.name = "RoundLifecyclePayoutMissingError";
  }
}

export class RoundLifecyclePayoutNotConfirmedError extends Error {
  constructor() {
    super("This round's payout has not been confirmed by the recipient yet.");
    this.name = "RoundLifecyclePayoutNotConfirmedError";
  }
}

export class RoundLifecyclePayoutDisputedError extends Error {
  constructor() {
    super("This round's payout was disputed by the recipient and can never close.");
    this.name = "RoundLifecyclePayoutDisputedError";
  }
}

export class RoundLifecycleIntegrityError extends Error {
  constructor() {
    super("This circle's persisted round lifecycle history is inconsistent and cannot be safely advanced.");
    this.name = "RoundLifecycleIntegrityError";
  }
}

// Re-exported so a caller can catch the whole round-lifecycle error
// surface from this one module without also needing to import the
// domain layer -- unchanged from every other financial service's own
// identical re-export pattern.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type LifecycleRoundResult = {
  readonly id: string;
  readonly roundNumber: number;
  // Deliberately not narrowed to a single literal: a replay can
  // truthfully observe a round that has progressed further than the
  // specific transition being reported (e.g. `activateFirstRound`
  // replaying after round 1 has since also been CLOSED) -- this must
  // report the round's true current status, never a value implied only
  // by which operation was called (7K.11 §21 "truthfulness matters more
  // than exact shape").
  readonly status: "ACTIVE" | "CLOSED";
  readonly activatedAt: string;
  readonly activatedById: string;
  readonly closedAt: string | null;
  readonly closedById: string | null;
};

export type ActivateFirstRoundResult = {
  readonly circleId: string;
  readonly round: LifecycleRoundResult;
  readonly replayed: boolean;
};

export type AdvanceRoundResult = {
  readonly circleId: string;
  readonly closedRound: LifecycleRoundResult;
  readonly activatedRound: LifecycleRoundResult | null;
  readonly isFinalRound: boolean;
  readonly replayed: boolean;
};

type Client = PrismaClient | Prisma.TransactionClient;

function serializeLifecycleRound(round: LifecycleRoundRecord): LifecycleRoundResult {
  if (round.activatedAt === null || round.activatedById === null) {
    throw new RoundLifecycleIntegrityError();
  }
  if (round.status !== "ACTIVE" && round.status !== "CLOSED") {
    throw new RoundLifecycleIntegrityError();
  }
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status: round.status,
    activatedAt: round.activatedAt.toISOString(),
    activatedById: round.activatedById,
    closedAt: round.closedAt?.toISOString() ?? null,
    closedById: round.closedById,
  };
}

function findSuccessor(rounds: readonly LifecycleRoundRecord[], round: LifecycleRoundRecord): LifecycleRoundRecord | null {
  return rounds.find((candidate) => candidate.roundNumber === round.roundNumber + 1) ?? null;
}

/**
 * Wraps the shared, pure round-lifecycle-state-shape validator
 * (src/domain/round-lifecycle.ts) with this service's own named
 * integrity error -- the identical function circle.service.ts's own
 * assertActivatedRotationIntegrity calls (wrapped there as
 * CircleActivationIntegrityError instead), so the two callers can never
 * silently drift into different definitions of "a coherent round-
 * lifecycle state" (7K.11 §21.3/7K.13 section 6).
 */
function assertLifecycleStateIntegrity(rounds: readonly LifecycleRoundRecord[]): void {
  try {
    assertRotationSequenceIntegrity(rounds);
    assertRoundLifecycleStateIntegrity(rounds);
  } catch (error) {
    if (error instanceof RoundLifecycleStateIntegrityError) throw new RoundLifecycleIntegrityError();
    throw error;
  }
}

/**
 * The round's authoritative expected payout, recomputed fresh from
 * frozen ContributionObligation history -- the identical domain function
 * (computeExpectedPayoutAmount) and the identical "reuse, never
 * reimplement" posture payout-recording/confirmation/dispute.service.ts
 * and payout-owner-read/member-read.service.ts already apply. Also
 * returns the raw obligation rows, since the contribution-fulfillment
 * check below needs them too and must not query them a second time.
 */
async function loadRoundObligations(
  client: Client,
  circleId: string,
  roundId: string,
): Promise<{ obligations: LifecycleObligationRecord[]; expected: ExpectedPayoutAmount }> {
  const obligations = await findObligationsForLifecycleRound(client, circleId, roundId);
  const expected = computeExpectedPayoutAmount(obligations);
  return { obligations, expected };
}

/**
 * Contribution-fulfillment authority for round closure (7K.13 section
 * 12): fetches this round's confirmed-payment ledger sums, then delegates
 * the actual "ready / incomplete / corrupt" classification to the shared,
 * pure `assessContributionClosureReadiness` (src/domain/round-lifecycle.ts,
 * extracted 7K.15 so `round-lifecycle-owner-read.service.ts`'s own display
 * projection can reuse the identical predicate, never a second,
 * independently-drifting rule). This function's own external contract
 * (throws `RoundLifecycleIntegrityError` for corruption,
 * `RoundLifecycleContributionsIncompleteError` for ordinary
 * incompleteness) is unchanged.
 */
async function assertContributionsReadyToClose(
  client: Client,
  obligations: readonly LifecycleObligationRecord[],
): Promise<void> {
  const confirmedSums = await findConfirmedPaymentSumsForLifecycle(
    client,
    obligations.map((obligation) => obligation.id),
  );
  const confirmedByObligationId = new Map(confirmedSums.map((row) => [row.obligationId, row.confirmedAmount]));

  let readiness: "READY" | "INCOMPLETE";
  try {
    readiness = assessContributionClosureReadiness(
      obligations.map((obligation) => ({
        expectedAmount: obligation.expectedAmount,
        status: obligation.status,
        fulfilledAt: obligation.fulfilledAt,
        confirmedAmount: confirmedByObligationId.get(obligation.id) ?? new Prisma.Decimal(0),
      })),
    );
  } catch (error) {
    if (error instanceof RoundLifecycleFinancialIntegrityError) throw new RoundLifecycleIntegrityError();
    throw error;
  }

  if (readiness === "INCOMPLETE") throw new RoundLifecycleContributionsIncompleteError();
}

/**
 * Payout-closure authority for round closure (7K.13 section 13):
 * delegates the actual "ready / missing / not-confirmed / disputed /
 * corrupt" classification to the shared, pure
 * `assessPayoutClosureReadiness` (src/domain/round-lifecycle.ts,
 * extracted 7K.15 for the identical reason as
 * assertContributionsReadyToClose above). This function's own external
 * contract (throws the specific named error per outcome) is unchanged.
 */
function assertPayoutReadyToClose(
  payout: LifecyclePayoutRecord | null,
  round: LifecycleRoundRecord,
  expected: ExpectedPayoutAmount,
): void {
  let readiness: "MISSING" | "NOT_CONFIRMED" | "DISPUTED" | "READY";
  try {
    readiness = assessPayoutClosureReadiness(payout, round.recipientId, expected);
  } catch (error) {
    if (error instanceof RoundLifecycleFinancialIntegrityError) throw new RoundLifecycleIntegrityError();
    throw error;
  }

  if (readiness === "MISSING") throw new RoundLifecyclePayoutMissingError();
  if (readiness === "NOT_CONFIRMED") throw new RoundLifecyclePayoutNotConfirmedError();
  if (readiness === "DISPUTED") throw new RoundLifecyclePayoutDisputedError();
}

/**
 * Resolves a request to activate round 1 when round 1 is already
 * ACTIVE or CLOSED (7K.13 section 20 / 7K.11 §21.21): a safe, zero-write
 * replay as long as round 1's own activation provenance is coherent --
 * the caller's original intent ("round 1 has started") was genuinely
 * satisfied, whether or not it has since progressed further. Never
 * reactivates or rewrites anything.
 */
function resolveActivateFirstRoundReplay(circleId: string, roundOne: LifecycleRoundRecord): ActivateFirstRoundResult {
  return { circleId, round: serializeLifecycleRound(roundOne), replayed: true };
}

/**
 * Activates round 1 of an already-ACTIVE circle -- the frozen 7K.11
 * Option B first-round-activation contract (§21.7): activateCircle
 * itself is never touched by this function and remains exactly what it
 * already was (every round created UPCOMING); this is the separate,
 * explicit owner action that starts round 1's own collection period.
 * Never based on startDate, dueDate, current date, a read, a login, or
 * any financial activity -- only this explicit call, by the owner, does
 * it.
 */
export async function activateFirstRound(params: {
  ownerId: string;
  circleId: string;
}): Promise<ActivateFirstRoundResult> {
  const { ownerId, circleId } = params;

  const circle = await findCircleForRoundLifecycle(prisma, circleId);
  if (!circle) throw new RoundLifecycleCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new RoundLifecycleAuthorizationError();

  const rounds = await findRoundsForLifecycle(prisma, circleId);
  if (rounds.length === 0) {
    // No rounds exist at all -- this circle was never activated (still
    // DRAFT, or CANCELLED before ever activating). Never activated is
    // not the same fact as corrupted: activateCircle is the only writer
    // that ever creates PayoutRound rows, and it always creates the full
    // set atomically, so a circle with zero rounds simply hasn't reached
    // that point yet.
    throw new RoundLifecycleCircleNotActiveError();
  }
  assertLifecycleStateIntegrity(rounds);
  const roundOne = rounds.find((round) => round.roundNumber === 1);
  if (!roundOne) throw new RoundLifecycleIntegrityError();

  if (roundOne.status === "ACTIVE" || roundOne.status === "CLOSED") {
    return resolveActivateFirstRoundReplay(circleId, roundOne);
  }
  if (roundOne.status !== "UPCOMING") throw new RoundLifecycleIntegrityError();

  if (circle.status !== "ACTIVE") throw new RoundLifecycleCircleNotActiveError();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new RoundLifecycleCircleNotFoundError();

    const freshCircle = await findCircleForRoundLifecycle(transaction, circleId);
    if (!freshCircle) throw new RoundLifecycleCircleNotFoundError();
    if (freshCircle.ownerId !== ownerId) throw new RoundLifecycleAuthorizationError();

    // Re-check everything under the lock: another concurrent
    // activateFirstRound call may have already committed between our
    // unlocked reads above and this transaction acquiring the lock.
    const freshRounds = await findRoundsForLifecycle(transaction, circleId);
    if (freshRounds.length === 0) throw new RoundLifecycleCircleNotActiveError();
    assertLifecycleStateIntegrity(freshRounds);

    const freshRoundOne = freshRounds.find((round) => round.roundNumber === 1);
    if (!freshRoundOne) throw new RoundLifecycleIntegrityError();

    if (freshRoundOne.status === "ACTIVE" || freshRoundOne.status === "CLOSED") {
      return resolveActivateFirstRoundReplay(circleId, freshRoundOne);
    }
    if (freshRoundOne.status !== "UPCOMING") throw new RoundLifecycleIntegrityError();

    // Fresh-start precondition (7K.13 section 5): every round must still
    // be UPCOMING -- assertLifecycleStateIntegrity already guarantees the
    // overall shape is coherent, but a fresh *first* activation
    // specifically requires the "nothing has started yet" shape, not
    // merely "some coherent shape."
    if (!freshRounds.every((round) => round.status === "UPCOMING")) {
      throw new RoundLifecycleIntegrityError();
    }

    if (freshCircle.status !== "ACTIVE") throw new RoundLifecycleCircleNotActiveError();

    const activatedAt = new Date();
    const transition = await activateLifecycleRound(transaction, {
      roundId: freshRoundOne.id,
      circleId,
      activatedAt,
      activatedById: ownerId,
    });
    if (transition.count !== 1) {
      // Never guess: re-read fresh state and resolve it properly. Under
      // the row lock this branch should be unreachable, but the CAS
      // contract is honored regardless.
      const raced = await findRoundsForLifecycle(transaction, circleId);
      const racedRoundOne = raced.find((round) => round.roundNumber === 1);
      if (!racedRoundOne || racedRoundOne.status === "UPCOMING") throw new RoundLifecycleIntegrityError();
      return resolveActivateFirstRoundReplay(circleId, racedRoundOne);
    }

    return {
      circleId,
      round: serializeLifecycleRound({ ...freshRoundOne, status: "ACTIVE", activatedAt, activatedById: ownerId }),
      replayed: false,
    };
  });
}

/**
 * Resolves a request to advance a round that is already CLOSED (7K.13
 * section 21 / 7K.11 §21.21): a safe, zero-write replay as long as the
 * requested round's own closure provenance is coherent AND (if a
 * successor exists) the successor's own activation provenance is
 * coherent -- the successor is NOT required to still be ACTIVE, since
 * legitimate further progression (the successor itself since closing,
 * and so on) must not break replay of this specific, earlier, already-
 * successful transition. A successor that was never activated at all
 * (still UPCOMING) contradicts this service's own atomicity guarantee
 * and is refused as corruption, never silently activated now.
 */
function resolveAdvanceReplay(
  circleId: string,
  rounds: readonly LifecycleRoundRecord[],
  requested: LifecycleRoundRecord,
): AdvanceRoundResult {
  const successor = findSuccessor(rounds, requested);
  if (successor && successor.status === "UPCOMING") {
    throw new RoundLifecycleIntegrityError();
  }

  return {
    circleId,
    closedRound: serializeLifecycleRound(requested),
    activatedRound: successor ? serializeLifecycleRound(successor) : null,
    isFinalRound: successor === null,
    replayed: true,
  };
}

/**
 * Advances the circle's current ACTIVE round: closes it, and, unless it
 * is the final round, atomically activates its successor in the SAME
 * transaction under the SAME lock (7K.11 §21.12) -- closeRound and
 * activateNextRound are never exposed as separate public operations
 * (7K.13 section 2), so no caller of this function can ever observe or
 * cause a state where the current round is CLOSED but its successor
 * remains UPCOMING.
 *
 * `roundId` names the round being CLOSED (the current ACTIVE round the
 * owner is choosing to advance past) -- its successor is always derived
 * from persisted roundNumber sequencing, never separately supplied
 * (7K.11 §21.11/§21.22).
 */
export async function advanceRound(params: {
  ownerId: string;
  circleId: string;
  roundId: string;
}): Promise<AdvanceRoundResult> {
  const { ownerId, circleId, roundId } = params;

  const circle = await findCircleForRoundLifecycle(prisma, circleId);
  if (!circle) throw new RoundLifecycleCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new RoundLifecycleAuthorizationError();

  const rounds = await findRoundsForLifecycle(prisma, circleId);
  assertLifecycleStateIntegrity(rounds);
  const requested = rounds.find((round) => round.id === roundId);
  if (!requested) throw new RoundLifecycleRoundNotFoundError();

  // Replay/terminal resolution BEFORE the ACTIVE-circle check and
  // without the lock -- mirrors confirmPayout/disputePayout's own
  // idempotent-replay-before-ACTIVE-check ordering (7K.4/7K.5): a
  // legitimate replay of an already-CLOSED round must remain resolvable
  // even after the circle has since become COMPLETED/ARCHIVED.
  if (requested.status === "CLOSED") {
    return resolveAdvanceReplay(circleId, rounds, requested);
  }
  if (requested.status === "UPCOMING") {
    // An UPCOMING round is never a legitimate target -- whether it is a
    // genuinely arbitrary/out-of-sequence request, or a stale request
    // for a round that simply hasn't become current yet, the answer is
    // identical: this is not the round to advance.
    throw new RoundLifecycleNotCurrentError();
  }
  // requested.status === "ACTIVE" from here.

  if (circle.status !== "ACTIVE") throw new RoundLifecycleCircleNotActiveError();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new RoundLifecycleCircleNotFoundError();

    const freshCircle = await findCircleForRoundLifecycle(transaction, circleId);
    if (!freshCircle) throw new RoundLifecycleCircleNotFoundError();
    if (freshCircle.ownerId !== ownerId) throw new RoundLifecycleAuthorizationError();

    // Re-check everything under the lock: another concurrent advanceRound
    // call for the SAME round, or a competing financial mutation (a late
    // contribution confirmation, a payout confirmation/dispute) for this
    // round's own obligations/payout, may have already committed between
    // our unlocked reads above and this transaction acquiring the lock.
    const freshRounds = await findRoundsForLifecycle(transaction, circleId);
    assertLifecycleStateIntegrity(freshRounds);

    const freshRequested = freshRounds.find((round) => round.id === roundId);
    if (!freshRequested) throw new RoundLifecycleRoundNotFoundError();

    if (freshRequested.status === "CLOSED") {
      return resolveAdvanceReplay(circleId, freshRounds, freshRequested);
    }
    if (freshRequested.status !== "ACTIVE") {
      throw new RoundLifecycleNotCurrentError();
    }

    if (freshCircle.status !== "ACTIVE") throw new RoundLifecycleCircleNotActiveError();

    // Financial closure predicate (7K.13 sections 11-13), verified fresh
    // under the lock -- never trusted from the unlocked pre-check above.
    const { obligations, expected } = await loadRoundObligations(transaction, circleId, freshRequested.id);
    await assertContributionsReadyToClose(transaction, obligations);
    const payout = await findPayoutForLifecycleRound(transaction, circleId, freshRequested.id);
    assertPayoutReadyToClose(payout, freshRequested, expected);

    const successor = findSuccessor(freshRounds, freshRequested);
    // One authoritative transition instant for BOTH halves of this one
    // atomic lifecycle event (7K.13 section 19): closing the current
    // round and activating its successor are not two independent
    // financial facts that happened to occur near each other -- they are
    // the SAME owner decision, made once, so they share one server-
    // authoritative timestamp rather than two independently-read clock
    // values a few microseconds apart.
    const transitionAt = new Date();

    const closeTransition = await closeLifecycleRound(transaction, {
      roundId: freshRequested.id,
      circleId,
      closedAt: transitionAt,
      closedById: ownerId,
    });
    if (closeTransition.count !== 1) {
      // Never guess: re-read fresh state and resolve it properly. Under
      // the row lock this branch should be unreachable, but the CAS
      // contract is honored regardless.
      const raced = await findRoundsForLifecycle(transaction, circleId);
      const racedRequested = raced.find((round) => round.id === roundId);
      if (!racedRequested) throw new RoundLifecycleRoundNotFoundError();
      if (racedRequested.status === "CLOSED") return resolveAdvanceReplay(circleId, raced, racedRequested);
      throw new RoundLifecycleIntegrityError();
    }

    let activatedRound: LifecycleRoundResult | null = null;
    if (successor) {
      const activateTransition = await activateLifecycleRound(transaction, {
        roundId: successor.id,
        circleId,
        activatedAt: transitionAt,
        activatedById: ownerId,
      });
      if (activateTransition.count !== 1) throw new RoundLifecycleIntegrityError();
      activatedRound = serializeLifecycleRound({
        ...successor,
        status: "ACTIVE",
        activatedAt: transitionAt,
        activatedById: ownerId,
      });
    }

    return {
      circleId,
      closedRound: serializeLifecycleRound({
        ...freshRequested,
        status: "CLOSED",
        closedAt: transitionAt,
        closedById: ownerId,
      }),
      activatedRound,
      isFinalRound: successor === null,
      replayed: false,
    };
  });
}
