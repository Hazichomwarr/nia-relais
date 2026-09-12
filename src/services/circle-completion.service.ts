import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  computeExpectedPayoutAmount,
  type ExpectedPayoutAmount,
} from "@/src/domain/payout-accounting";
import {
  assertRotationSequenceIntegrity,
  assertRoundLifecycleStateIntegrity,
  assessContributionClosureReadiness,
  assessPayoutClosureReadiness,
  RoundLifecycleFinancialIntegrityError,
  RoundLifecycleStateIntegrityError,
} from "@/src/domain/round-lifecycle";
import {
  completeActiveCircle,
  findCircleForCompletion,
  findConfirmedPaymentSumsForCompletion,
  findObligationsForCompletion,
  findPayoutsForCompletion,
  type CompletionCircleRecord,
  type CompletionObligationRecord,
  type CompletionPayoutRecord,
} from "@/src/repositories/circle-completion.repository";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import { findRoundsForLifecycle, type LifecycleRoundRecord } from "@/src/repositories/round-lifecycle.repository";
import { prisma } from "@/src/prisma";

// Implements the frozen 7L completion contract
// (docs/product/susu-circle-completion-audit.md): exactly one public
// operation, completeCircle -- ACTIVE -> COMPLETED, owner-only, explicit
// (never automatic, never time-driven). Structure mirrors every other
// SUSU lifecycle writer (activateFirstRound/advanceRound,
// round-lifecycle.service.ts): an unlocked, fail-fast pre-check
// (ownership, then a terminal/replay short-circuit that never needs the
// lock, then the cheap structural "every round CLOSED" check) followed
// by a locked, authoritative transaction that re-checks everything once
// more under the SAME shared SavingsCircle lock (lockSavingsCircleForUpdate,
// unchanged, unmodified) before ever running the expensive per-round
// financial revalidation or writing anything.
//
// This module writes ONLY SavingsCircle.status/completedAt/completedById.
// It never touches activatedAt/activatedById/archivedAt/archivedById, and
// never writes any PayoutRound/ContributionObligation/ContributionPayment/
// Payout/CircleMember row -- round provenance is permanent and frozen the
// moment each round closed (7K.13), and completion must never rewrite it.
// No Server Action, UI, schema change, archive, reopening, cancellation,
// notification, or payment execution is introduced here (7L section 1).

export class CircleCompletionNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "CircleCompletionNotFoundError";
  }
}

export class CircleCompletionAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to complete this circle.");
    this.name = "CircleCompletionAuthorizationError";
  }
}

export class CircleCompletionNotActiveError extends Error {
  constructor() {
    super("Only an active circle whose entire rotation has closed can be marked complete.");
    this.name = "CircleCompletionNotActiveError";
  }
}

export class CircleCompletionRoundsIncompleteError extends Error {
  constructor() {
    super("Not every round in this circle's rotation has closed yet.");
    this.name = "CircleCompletionRoundsIncompleteError";
  }
}

export class CircleCompletionIntegrityError extends Error {
  constructor() {
    super("This circle's persisted rotation history is inconsistent and cannot be safely completed.");
    this.name = "CircleCompletionIntegrityError";
  }
}

// Re-exported so a caller can catch the whole completion error surface
// from this one module without also needing to import the domain layer --
// unchanged from round-lifecycle.service.ts's own identical re-export
// pattern for the identical underlying domain error.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type CircleCompletionResult = {
  readonly circleId: string;
  readonly status: "COMPLETED";
  readonly completedAt: string;
  readonly completedById: string;
  readonly replayed: boolean;
};

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Wraps the shared, pure round-lifecycle-state-shape validators
 * (src/domain/round-lifecycle.ts) with this service's own named integrity
 * error -- the SAME functions circle.service.ts's own
 * assertActivatedRotationIntegrity and round-lifecycle.service.ts's own
 * assertLifecycleStateIntegrity already each wrap in their own named
 * error (7L section 6/7): a third wrapper, never a fourth,
 * independently-drifting reimplementation of the underlying rule. Proves,
 * at minimum: at least two rounds, the exact 1..N sequence, and per-round
 * lifecycle-state/provenance coherence -- never merely
 * `rounds.every(r => r.status === "CLOSED")` on its own.
 */
function assertRotationIntegrityForCompletion(rounds: readonly LifecycleRoundRecord[]): void {
  try {
    assertRotationSequenceIntegrity(rounds);
    assertRoundLifecycleStateIntegrity(rounds);
  } catch (error) {
    if (error instanceof RoundLifecycleStateIntegrityError) throw new CircleCompletionIntegrityError();
    throw error;
  }
}

/**
 * Defense-in-depth financial revalidation for ONE already-CLOSED round
 * (frozen 7L section 5/9, Option B): re-derives truth from the same
 * shared, ledger-truth predicates round-lifecycle.service.ts's own
 * advanceRound already used to justify that round's own closure --
 * assessContributionClosureReadiness/assessPayoutClosureReadiness, never a
 * weaker completion-specific approximation. Unlike advanceRound (where
 * INCOMPLETE/MISSING/NOT_CONFIRMED/DISPUTED are all ordinary, waitable
 * business states for a round not yet CLOSED), every one of those outcomes
 * here is impossible for a round already persisted CLOSED -- so any
 * outcome other than READY is reported as CircleCompletionIntegrityError,
 * never as "rounds incomplete."
 */
function assertRoundFinanciallyReadyForCompletion(
  round: Pick<LifecycleRoundRecord, "recipientId">,
  obligations: readonly CompletionObligationRecord[],
  confirmedByObligationId: ReadonlyMap<string, Prisma.Decimal>,
  payout: CompletionPayoutRecord | null,
): void {
  // computeExpectedPayoutAmount itself throws PayoutAccountingIntegrityError
  // (re-exported above, unchanged) for an empty or currency-inconsistent
  // obligation set -- deliberately left unwrapped, identical to
  // round-lifecycle.service.ts's own loadRoundObligations, which never
  // catches it either.
  const expected: ExpectedPayoutAmount = computeExpectedPayoutAmount(obligations);

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
    if (error instanceof RoundLifecycleFinancialIntegrityError) throw new CircleCompletionIntegrityError();
    throw error;
  }
  if (contributionReadiness !== "READY") throw new CircleCompletionIntegrityError();

  let payoutReadiness: "MISSING" | "NOT_CONFIRMED" | "DISPUTED" | "READY";
  try {
    payoutReadiness = assessPayoutClosureReadiness(payout, round.recipientId, expected);
  } catch (error) {
    if (error instanceof RoundLifecycleFinancialIntegrityError) throw new CircleCompletionIntegrityError();
    throw error;
  }
  if (payoutReadiness !== "READY") throw new CircleCompletionIntegrityError();
}

/**
 * Re-verifies EVERY persisted round's financial closure facts, batched
 * across the whole circle -- one query for every obligation, one for
 * every obligation's confirmed-payment ledger sum, one for every payout
 * (never one round-trip per round, mirroring payout-owner-read
 * .repository.ts's own established batching discipline).
 */
async function assertEveryRoundFinanciallyReadyForCompletion(
  client: Client,
  circleId: string,
  rounds: readonly LifecycleRoundRecord[],
): Promise<void> {
  const obligations = await findObligationsForCompletion(client, circleId);
  const confirmedSums = await findConfirmedPaymentSumsForCompletion(client, obligations.map((obligation) => obligation.id));
  const confirmedByObligationId = new Map(confirmedSums.map((row) => [row.obligationId, row.confirmedAmount]));
  const payouts = await findPayoutsForCompletion(client, circleId);
  const payoutByRoundId = new Map(payouts.map((payout) => [payout.roundId, payout]));

  for (const round of rounds) {
    const roundObligations = obligations.filter((obligation) => obligation.roundId === round.id);
    assertRoundFinanciallyReadyForCompletion(
      round,
      roundObligations,
      confirmedByObligationId,
      payoutByRoundId.get(round.id) ?? null,
    );
  }
}

/**
 * activatedAt/activatedById must already be present and coherent (7L
 * section 7) -- markCircleActive is the only writer of status -> ACTIVE,
 * and it always sets both non-null in the same CAS write, so an ACTIVE or
 * COMPLETED circle with either null is itself a genuine, independent
 * corruption signal, unreachable via any known writer but never silently
 * passed over.
 */
function assertActivationProvenanceCoherent(circle: Pick<CompletionCircleRecord, "activatedAt" | "activatedById">): void {
  if (circle.activatedAt === null || circle.activatedById === null) throw new CircleCompletionIntegrityError();
}

/**
 * Resolves a legitimate same-owner replay of an already-COMPLETED circle
 * (frozen 7L section 5/9/23): zero writes, no timestamp/actor
 * regeneration -- the row's original, first-written completion provenance
 * is always what is returned. completedById can only ever equal
 * circle.ownerId by construction (ownerId is immutable, 7L section 18,
 * and the ORIGINAL completing call already required
 * circle.ownerId === callerOwnerId) -- any mismatch, any null
 * completedAt/completedById, or any non-null archivedAt/archivedById on a
 * circle that is COMPLETED rather than ARCHIVED, is a genuine integrity
 * contradiction, never treated as "a different owner's replay" (no such
 * concept exists in this model).
 */
function resolveCompletionReplay(circle: CompletionCircleRecord): CircleCompletionResult {
  assertActivationProvenanceCoherent(circle);
  if (circle.completedAt === null || circle.completedById === null) throw new CircleCompletionIntegrityError();
  if (circle.completedById !== circle.ownerId) throw new CircleCompletionIntegrityError();
  if (circle.archivedAt !== null || circle.archivedById !== null) throw new CircleCompletionIntegrityError();

  return {
    circleId: circle.id,
    status: "COMPLETED",
    completedAt: circle.completedAt.toISOString(),
    completedById: circle.completedById,
    replayed: true,
  };
}

/**
 * Explicitly, owner-only, completes a SUSU circle whose entire rotation
 * has closed: ACTIVE -> COMPLETED. Trusted inputs only (ownerId,
 * circleId) -- no operation id, round id, member id, payout id, or client
 * timestamp of any kind.
 */
export async function completeCircle(params: {
  ownerId: string;
  circleId: string;
}): Promise<CircleCompletionResult> {
  const { ownerId, circleId } = params;

  const circle = await findCircleForCompletion(prisma, circleId);
  if (!circle) throw new CircleCompletionNotFoundError();
  if (circle.ownerId !== ownerId) throw new CircleCompletionAuthorizationError();

  // Terminal replay resolved BEFORE the ACTIVE check and without the lock
  // -- mirrors advanceRound's own idempotent-replay-before-ACTIVE-check
  // ordering: a legitimate replay of an already-COMPLETED circle must
  // remain resolvable regardless of anything else.
  if (circle.status === "COMPLETED") {
    return resolveCompletionReplay(circle);
  }
  // DRAFT, CANCELLED, and ARCHIVED are all "not currently ACTIVE" (7L
  // section 6) -- a single error, exactly like round-lifecycle's own one
  // RoundLifecycleCircleNotActiveError for "anything not ACTIVE."
  if (circle.status !== "ACTIVE") throw new CircleCompletionNotActiveError();
  assertActivationProvenanceCoherent(circle);

  const rounds = await findRoundsForLifecycle(prisma, circleId);
  assertRotationIntegrityForCompletion(rounds);
  if (!rounds.every((round) => round.status === "CLOSED")) {
    // Normal, waitable business state -- never corruption (7L section 8).
    throw new CircleCompletionRoundsIncompleteError();
  }

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new CircleCompletionNotFoundError();

    const freshCircle = await findCircleForCompletion(transaction, circleId);
    if (!freshCircle) throw new CircleCompletionNotFoundError();
    if (freshCircle.ownerId !== ownerId) throw new CircleCompletionAuthorizationError();

    // Re-check everything under the lock: another concurrent
    // completeCircle call, or a final advanceRound that had not yet
    // committed at the time of the unlocked pre-check above, may have
    // already changed persisted state between then and now.
    if (freshCircle.status === "COMPLETED") {
      return resolveCompletionReplay(freshCircle);
    }
    if (freshCircle.status !== "ACTIVE") throw new CircleCompletionNotActiveError();
    assertActivationProvenanceCoherent(freshCircle);

    const freshRounds = await findRoundsForLifecycle(transaction, circleId);
    assertRotationIntegrityForCompletion(freshRounds);
    if (!freshRounds.every((round) => round.status === "CLOSED")) {
      throw new CircleCompletionRoundsIncompleteError();
    }

    // Defense-in-depth financial revalidation (frozen 7L section 5/9,
    // Option B), only now -- inside the lock, and only once every cheap
    // structural check has already passed.
    await assertEveryRoundFinanciallyReadyForCompletion(transaction, circleId, freshRounds);

    const completedAt = new Date();
    const transition = await completeActiveCircle(transaction, { circleId, ownerId, completedAt });
    if (transition.count !== 1) {
      // Never guess: re-read fresh state and resolve it properly. Under
      // the row lock this branch should be unreachable, but the CAS
      // contract is honored regardless (identical posture to
      // activateFirstRound/advanceRound's own CAS-miss handling).
      const raced = await findCircleForCompletion(transaction, circleId);
      if (!raced) throw new CircleCompletionNotFoundError();
      if (raced.ownerId !== ownerId) throw new CircleCompletionAuthorizationError();
      if (raced.status === "COMPLETED") return resolveCompletionReplay(raced);
      throw new CircleCompletionIntegrityError();
    }

    return {
      circleId,
      status: "COMPLETED",
      completedAt: completedAt.toISOString(),
      completedById: ownerId,
      replayed: false,
    };
  });
}
