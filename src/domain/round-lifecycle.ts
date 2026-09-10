import { Prisma } from "@prisma/client";

import { isObligationFulfilled } from "@/src/domain/contribution-accounting";
import { amountMatchesExpectedPayout, type ExpectedPayoutAmount } from "@/src/domain/payout-accounting";

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
//
// 7K.15 extraction: assessContributionClosureReadiness/
// assessPayoutClosureReadiness (below) are the SAME per-obligation/
// per-payout financial-closure predicate round-lifecycle.service.ts's own
// assertContributionsReadyToClose/assertPayoutReadyToClose used to inline
// directly -- extracted here, unchanged in substance, so
// round-lifecycle-owner-read.service.ts (7K.15) can classify the exact
// same "ready / ordinary blocker / corruption" outcome for DISPLAY that
// round-lifecycle.service.ts uses to decide whether advanceRound may
// WRITE, without either module reimplementing the other's rule or the
// read model calling the mutation service "to check." Both callers wrap
// this module's own `RoundLifecycleFinancialIntegrityError` in their own
// named integrity error, exactly like they already each wrap
// `RoundLifecycleStateIntegrityError`.

export class RoundLifecycleStateIntegrityError extends Error {
  constructor(message = "This circle's persisted round lifecycle state is inconsistent.") {
    super(message);
    this.name = "RoundLifecycleStateIntegrityError";
  }
}

export class RoundLifecycleFinancialIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoundLifecycleFinancialIntegrityError";
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

export type ContributionClosureObligation = {
  readonly expectedAmount: Prisma.Decimal;
  readonly status: string;
  readonly fulfilledAt: Date | null;
  readonly confirmedAmount: Prisma.Decimal;
};

/**
 * The round-closure contribution-readiness predicate (7K.13 section 12,
 * extracted 7K.15): re-derives each obligation's TRUE fulfillment from its
 * caller-supplied confirmed-payment ledger total (isObligationFulfilled,
 * contribution-accounting.ts) -- ContributionObligation.status is never
 * trusted as sole payment truth -- but refuses outright, as a genuine
 * integrity failure rather than ordinary incompleteness, whenever the
 * persisted status/fulfilledAt DISAGREES with the ledger it is supposed to
 * project. The caller is responsible for fetching every obligation for the
 * round and its own confirmed-payment sum (this function has no database
 * access of its own); an empty obligation set is itself a failure (a
 * validly activated round always has at least one obligation per member),
 * never treated as "nothing to confirm."
 *
 * Returns "READY" only once every obligation is both status-coherent AND
 * ledger-fulfilled; "INCOMPLETE" is an ordinary, waitable business state,
 * never conflated with the thrown integrity failure.
 */
export function assessContributionClosureReadiness(
  obligations: readonly ContributionClosureObligation[],
): "READY" | "INCOMPLETE" {
  if (obligations.length === 0) {
    throw new RoundLifecycleFinancialIntegrityError(
      "No contribution obligations exist for this round; closure readiness cannot be determined.",
    );
  }

  let allFulfilled = true;
  for (const obligation of obligations) {
    const ledgerFulfilled = isObligationFulfilled(obligation.confirmedAmount, obligation.expectedAmount);
    const statusFulfilled = obligation.status === "FULFILLED";

    if (statusFulfilled !== ledgerFulfilled) {
      throw new RoundLifecycleFinancialIntegrityError(
        "A contribution obligation's persisted status disagrees with its confirmed-payment ledger.",
      );
    }
    if (statusFulfilled && obligation.fulfilledAt === null) {
      throw new RoundLifecycleFinancialIntegrityError("A FULFILLED obligation must carry a fulfilledAt timestamp.");
    }
    if (!statusFulfilled && obligation.fulfilledAt !== null) {
      throw new RoundLifecycleFinancialIntegrityError("An OPEN obligation must carry no fulfilledAt timestamp.");
    }

    if (!ledgerFulfilled) allFulfilled = false;
  }

  return allFulfilled ? "READY" : "INCOMPLETE";
}

export type PayoutClosurePayout = {
  readonly status: string;
  readonly currency: string;
  readonly amount: Prisma.Decimal;
  readonly recordedById: string;
  readonly confirmedAt: Date | null;
  readonly confirmedByMemberId: string | null;
  readonly disputedAt: Date | null;
  readonly disputedByMemberId: string | null;
  readonly disputeReason: string | null;
};

/**
 * The round-closure payout-readiness predicate (7K.13 section 13,
 * extracted 7K.15): a missing or non-CONFIRMED payout is ordinary
 * incompleteness (a specific, distinct classification per status); a
 * CONFIRMED payout is re-verified against the round's own frozen
 * recipient/expected amount -- any incoherence there is refused as a
 * genuine integrity failure, never silently downgraded to "not ready."
 * DISPUTED is always a valid persisted terminal business state, never
 * treated as corruption.
 */
export function assessPayoutClosureReadiness(
  payout: PayoutClosurePayout | null,
  recipientId: string,
  expected: ExpectedPayoutAmount,
): "MISSING" | "NOT_CONFIRMED" | "DISPUTED" | "READY" {
  if (!payout) return "MISSING";
  if (payout.status === "RECORDED") return "NOT_CONFIRMED";
  if (payout.status === "DISPUTED") return "DISPUTED";
  if (payout.status !== "CONFIRMED") {
    throw new RoundLifecycleFinancialIntegrityError("A round's persisted payout has an unrecognized status.");
  }

  if (
    payout.currency !== expected.currency
    || !amountMatchesExpectedPayout(payout.amount, expected.amount)
    || payout.recordedById.length === 0
    || payout.confirmedAt === null
    || payout.confirmedByMemberId === null
    || payout.confirmedByMemberId !== recipientId
    || payout.disputedAt !== null
    || payout.disputedByMemberId !== null
    || payout.disputeReason !== null
  ) {
    throw new RoundLifecycleFinancialIntegrityError("A CONFIRMED payout's persisted fields are internally inconsistent.");
  }

  return "READY";
}
