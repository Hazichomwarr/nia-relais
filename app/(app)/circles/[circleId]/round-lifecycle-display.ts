import type {
  OwnerRoundLifecycleBlocker,
  OwnerRoundLifecycleTransitionKind,
} from "@/src/services/round-lifecycle-owner-read.service";

// Pure, framework-free copy-mapping helpers for the owner round-lifecycle
// card (7K.16) -- no React, no service/repository access, nothing async.
// These map values getOwnerRoundLifecycle (round-lifecycle-owner-read
// .service.ts, 7K.15) already decided to safe UI copy; they compute no
// eligibility, no financial readiness, no final-round status, and no
// current/next round selection of their own -- the read model remains
// the sole authority for all of that.

/**
 * Exact wording per the 7K.16 spec (section 10): each ordinary business
 * blocker gets its own distinct explanation. PAYOUT_DISPUTED is worded
 * as a permanent workflow fact, never as something to fix/retry/resolve/
 * override/refund/adjudicate -- disputePayout is a member-only decision
 * this owner-facing UI has no authority to reverse or route around.
 */
export function getBlockerMessage(blocker: OwnerRoundLifecycleBlocker): string {
  switch (blocker) {
    case "CONTRIBUTIONS_INCOMPLETE":
      return "All contributions for this round must be confirmed before it can be closed.";
    case "PAYOUT_MISSING":
      return "The payout still needs to be recorded and confirmed.";
    case "PAYOUT_NOT_CONFIRMED":
      return "The payout has been recorded. The recipient still needs to confirm that it was received.";
    case "PAYOUT_DISPUTED":
      return "The recipient disputed this payout. Under the current NIA workflow, this round cannot advance.";
  }
}

/**
 * The advance CTA's own label, truthfully describing the one atomic
 * operation advanceRoundAction performs (7K.16 sections 12/14): a
 * non-final round's label names BOTH halves (closing the current round
 * and starting its already-known successor) so the owner never reads
 * this as two independent steps; a final round's label never implies
 * circle completion (never "Complete circle"/"Finish SUSU"/"Archive
 * circle"). currentRoundNumber/nextRoundNumber are display values only,
 * passed straight through from the read model's own currentRound/
 * nextRound -- this function performs no arithmetic to derive either.
 */
export function getAdvanceCtaLabel(
  transitionKind: OwnerRoundLifecycleTransitionKind,
  currentRoundNumber: number,
  nextRoundNumber: number | null,
): string {
  if (transitionKind === "CLOSE_FINAL_ROUND" || nextRoundNumber === null) {
    return "Close final round";
  }
  return `Close round ${currentRoundNumber} & start round ${nextRoundNumber}`;
}
