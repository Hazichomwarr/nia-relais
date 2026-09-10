// Pure state-transition contract for the SUSU payout ledger -- no
// persistence, no service logic, nothing here writes anything. This is
// the single source of truth the future recordPayout/confirmPayout/
// disputePayout services (7K.3+) must conform to, frozen by the 7K audit
// and the 7K.1 "V1 Signed-Off Contract" (see
// docs/product/susu-payout-workflow-audit.md, item 2). Mirrors
// contribution-state.ts's own shape exactly, with one structural
// difference this file makes deliberately visible rather than hidden:
// a Payout row represents ONE PERMANENT historical payout attempt for
// one round (Payout.@@unique([roundId]) is a full, not partial, unique
// index -- there is no "fresh attempt after a terminal outcome" the way
// ContributionPayment allows after REJECTED). Because of that:
//
// - RECORDED is the owner's historical assertion that an external
//   payout occurred -- entered into NIA, not yet confirmed received.
// - CONFIRMED is the recipient's TERMINAL confirmation of that payout.
// - DISPUTED is the recipient's TERMINAL dispute of that payout.
//
// Terminal states are never repaired by moving the row into another
// business state -- not CONFIRMED -> DISPUTED, not DISPUTED ->
// CONFIRMED, not DISPUTED -> RECORDED, not CONFIRMED -> RECORDED, no
// deletion, no reset, no replacement row, no owner override. A
// mis-confirmed or disputed payout is, for V1, an administrative matter
// resolved outside the application -- the exact same posture already
// adopted for a mis-confirmed ContributionPayment (7J audit section 9)
// and reaffirmed here for Payout by 7K.1 (Option A, no schema
// migration).
//
// This file intentionally knows nothing about PayoutRound or
// PayoutRoundStatus -- round CLOSED/ACTIVE/UPCOMING is a separate
// lifecycle domain (7K.1 sign-off item 8), and no round-closure rule is
// encoded here. A future round-lifecycle module may read Payout.status
// as one of its own inputs, but this file never reaches upward into
// that concern.

export type PayoutStatus = "RECORDED" | "CONFIRMED" | "DISPUTED";

// RECORDED -> CONFIRMED or RECORDED -> DISPUTED, each terminal for that
// one Payout row. Neither CONFIRMED nor DISPUTED permits any further
// transition -- there is no reversal/correction/reset workflow in V1.
const PAYOUT_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  RECORDED: ["CONFIRMED", "DISPUTED"],
  CONFIRMED: [],
  DISPUTED: [],
};

export function isPayoutTransitionAllowed(from: PayoutStatus, to: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

/**
 * Documented (not implemented -- 7K.2 is domain/validation only)
 * expected behavior for the races and replays the future writers must
 * handle, frozen by 7K.1 sign-off item 6. Kept here, next to the
 * transition contract itself, so a future service's own tests can
 * assert its behavior against these exact string keys rather than
 * against prose that can drift out of sync with the code. No replay
 * path described below ever regenerates a timestamp or actor
 * provenance field -- every replay returns the row's original,
 * first-written values.
 *
 * - "duplicate-recording-operation": a retried recordPayout call with a
 *   clientOperationId that was already used for this circle, targeting
 *   the SAME round for the SAME amount, must resolve to the existing
 *   payout's outcome (idempotent replay), never insert a second row and
 *   never throw a raw uniqueness error to the caller.
 * - "recording-intent-conflict": a reused clientOperationId whose
 *   persisted round or amount does not match the caller's current
 *   input is a conflict, never a silent replay of a different intent.
 * - "already-recorded-conflict": a recordPayout call using a genuinely
 *   NEW clientOperationId, but targeting a round that already has a
 *   Payout row (recorded under a different operation), is a conflict --
 *   Payout's full @@unique([roundId]) means there is no "unresolved or
 *   confirmed" nuance to check the way contributions' partial index
 *   needs; any existing row at all blocks a new one.
 * - "duplicate-confirmation": a second confirmPayout call against a
 *   payout that is already CONFIRMED, with internally consistent
 *   provenance, must be a safe zero-write replay, never a raw error --
 *   detected via a conditional update affecting zero rows
 *   (WHERE status = 'RECORDED'), not via a separate read-then-write.
 * - "confirmation-on-disputed-conflict": a confirmPayout call against a
 *   payout that is already DISPUTED is a terminal conflict -- DISPUTED
 *   permits no transition to CONFIRMED, replay or otherwise.
 * - "duplicate-dispute": a second disputePayout call against a payout
 *   that is already DISPUTED, with the EXACT SAME disputeReason and
 *   internally consistent provenance, must be a safe zero-write replay.
 * - "dispute-intent-conflict": a second disputePayout call against an
 *   already-DISPUTED payout with a DIFFERENT disputeReason is a
 *   conflict, never a silent overwrite of the original reason.
 * - "dispute-on-confirmed-conflict": a disputePayout call against a
 *   payout that is already CONFIRMED is a terminal conflict -- CONFIRMED
 *   permits no transition to DISPUTED, replay or otherwise.
 */
export const PAYOUT_REPLAY_CONTRACT_KEYS = [
  "duplicate-recording-operation",
  "recording-intent-conflict",
  "already-recorded-conflict",
  "duplicate-confirmation",
  "confirmation-on-disputed-conflict",
  "duplicate-dispute",
  "dispute-intent-conflict",
  "dispute-on-confirmed-conflict",
] as const;
