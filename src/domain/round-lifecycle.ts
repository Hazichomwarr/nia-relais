// Pure, framework-free round-lifecycle-STATE integrity for the SUSU
// PayoutRound state machine (7K.13, implementing the frozen 7K.11
// contract, docs/product/susu-payout-workflow-audit.md §21.6/§21.8) --
// no Prisma client, no "server-only", nothing async. This module knows
// nothing about circles, members, obligations, or payouts -- it validates
// exactly one thing: whether a set of persisted PayoutRound rows forms a
// structurally coherent lifecycle-progression state, and nothing about
// WHY that state exists or whether it is financially justified.
//
// This is deliberately separate from circle.service.ts's own
// activation-time STRUCTURE integrity (member cohort size, obligation
// counts, due-date recurrence, recipient/payoutOrder mapping -- all
// IMMUTABLE, activation-time facts that never change once a circle is
// ACTIVE). This file instead validates the MUTABLE lifecycle-state facts
// (status, activatedAt/activatedById, closedAt/closedById) that DO change
// as a circle progresses -- exactly the "A. immutable activated-rotation
// integrity" vs "B. mutable lifecycle-state integrity" split the 7K.11
// audit's own §21.3 finding calls for. circle.service.ts's own
// `assertActivatedRotationIntegrity` calls into this module (see that
// file's own comment) rather than duplicating this logic, and
// round-lifecycle.service.ts uses it directly for its own preconditions.

export class RoundLifecycleStateIntegrityError extends Error {
  constructor(message = "This circle's persisted round lifecycle state is inconsistent.") {
    super(message);
    this.name = "RoundLifecycleStateIntegrityError";
  }
}

export type RoundLifecycleRoundRecord = {
  readonly roundNumber: number;
  readonly status: "UPCOMING" | "ACTIVE" | "CLOSED";
  readonly activatedAt: Date | null;
  readonly activatedById: string | null;
  readonly closedAt: Date | null;
  readonly closedById: string | null;
};

/**
 * The activation-time rotation-count/sequence invariant every validly
 * activated V1 circle must satisfy, independent of lifecycle progression:
 * at least two rounds (the same "at least two active members" floor
 * `assertActivationEligible` already enforces at activation), and
 * roundNumbers forming the exact sequence 1..N with no gap or duplicate.
 * `PayoutRound.@@unique([circleId, roundNumber])` already makes a
 * duplicate structurally impossible at the database level; this defends
 * against a gap (a missing round) or a cohort smaller than two, neither
 * of which the unique index alone rules out.
 */
export function assertRotationSequenceIntegrity(
  rounds: readonly Pick<RoundLifecycleRoundRecord, "roundNumber">[],
): void {
  if (rounds.length < 2) {
    throw new RoundLifecycleStateIntegrityError("A circle's persisted rotation must contain at least two rounds.");
  }
  const sortedNumbers = [...rounds].map((round) => round.roundNumber).sort((left, right) => left - right);
  for (const [index, roundNumber] of sortedNumbers.entries()) {
    if (roundNumber !== index + 1) {
      throw new RoundLifecycleStateIntegrityError("Persisted round numbers must form the exact sequence 1..N.");
    }
  }
}

/**
 * The frozen V1 lifecycle-state machine (7K.11 §21.6/§21.8): exactly
 * three shapes are ever valid, in roundNumber order --
 *
 *   A. Pre-start:        UPCOMING, UPCOMING, ..., UPCOMING
 *   B. In progress:      CLOSED, ..., CLOSED, ACTIVE, UPCOMING, ..., UPCOMING
 *   C. Final pre-completion: CLOSED, CLOSED, ..., CLOSED
 *
 * Modeled as three ordered phases a round's own status may only ever
 * move FORWARD through in roundNumber order -- CLOSED phase, then at most
 * one ACTIVE round, then the UPCOMING phase -- never backward. This
 * single pass rejects every one of the frozen contract's named
 * impossible shapes: more than one ACTIVE round; a CLOSED round
 * appearing after a non-CLOSED one (out-of-order closure); an ACTIVE
 * round with an earlier non-CLOSED round (skipped/out-of-sequence
 * activation); and, via the final zero-ACTIVE check below, a mid-rotation
 * state with no ACTIVE round at all (progression "stuck" without an
 * ACTIVE round to advance) -- the one legitimate zero-ACTIVE states being
 * exclusively "every round UPCOMING" or "every round CLOSED" (7K.11
 * §21.8).
 *
 * Also verifies per-round provenance coherence: UPCOMING carries no
 * activation/closure provenance at all; ACTIVE carries activation
 * provenance and no closure provenance; CLOSED carries both.
 */
export function assertRoundLifecycleStateIntegrity(
  rounds: readonly RoundLifecycleRoundRecord[],
): void {
  const sorted = [...rounds].sort((left, right) => left.roundNumber - right.roundNumber);

  let phase: "CLOSED" | "ACTIVE" | "UPCOMING" = "CLOSED";
  let activeCount = 0;

  for (const round of sorted) {
    if (round.status === "UPCOMING") {
      if (round.activatedAt !== null || round.activatedById !== null || round.closedAt !== null || round.closedById !== null) {
        throw new RoundLifecycleStateIntegrityError("An UPCOMING round must carry no activation or closure provenance.");
      }
    } else if (round.status === "ACTIVE") {
      if (round.activatedAt === null || round.activatedById === null) {
        throw new RoundLifecycleStateIntegrityError("An ACTIVE round must carry activation provenance.");
      }
      if (round.closedAt !== null || round.closedById !== null) {
        throw new RoundLifecycleStateIntegrityError("An ACTIVE round must carry no closure provenance.");
      }
    } else {
      // CLOSED
      if (round.activatedAt === null || round.activatedById === null || round.closedAt === null || round.closedById === null) {
        throw new RoundLifecycleStateIntegrityError("A CLOSED round must carry both activation and closure provenance.");
      }
    }

    if (round.status === "CLOSED") {
      if (phase !== "CLOSED") {
        throw new RoundLifecycleStateIntegrityError("A CLOSED round cannot appear after a non-CLOSED round.");
      }
    } else if (round.status === "ACTIVE") {
      if (phase === "UPCOMING") {
        throw new RoundLifecycleStateIntegrityError("An ACTIVE round cannot appear after the UPCOMING phase has begun.");
      }
      activeCount += 1;
      if (activeCount > 1) {
        throw new RoundLifecycleStateIntegrityError("At most one round may be ACTIVE at a time.");
      }
      phase = "ACTIVE";
    } else {
      // UPCOMING
      phase = "UPCOMING";
    }
  }

  if (activeCount === 0) {
    const allClosed = sorted.every((round) => round.status === "CLOSED");
    const allUpcoming = sorted.every((round) => round.status === "UPCOMING");
    if (!allClosed && !allUpcoming) {
      throw new RoundLifecycleStateIntegrityError(
        "A mid-rotation circle with no ACTIVE round must have every round either CLOSED or UPCOMING, never a mix with zero ACTIVE.",
      );
    }
  }
}
