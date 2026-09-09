// Pure state-transition contract for the SUSU contribution ledger -- no
// persistence, no service logic, nothing here writes anything. This is the
// single source of truth the future recording/confirmation/rejection
// services (7J.2+) must conform to, and that this ticket's own tests check
// against directly rather than only against prose. See
// docs/product/susu-contribution-workflow-audit.md section 4/5 for the
// domain reasoning behind each of these rules.

export type ContributionPaymentStatus = "RECORDED" | "CONFIRMED" | "REJECTED";
export type ContributionObligationStatus = "OPEN" | "FULFILLED";

// RECORDED -> CONFIRMED or RECORDED -> REJECTED, each terminal for that
// specific payment row. Neither CONFIRMED nor REJECTED permits any further
// transition -- there is no reversal/correction workflow in V1 (7J audit
// section 9, reaffirmed). A "fresh attempt" after REJECTED is always a NEW
// ContributionPayment row against the same obligation (the partial unique
// index only excludes RECORDED/CONFIRMED, never REJECTED), not a
// resurrection of the rejected row itself.
//
// Historical payment state vs. current obligation state (7J.4.1): a
// REJECTED row's own terminal status never changes, but its obligation
// can legitimately move on without it -- record A, reject A, record B,
// confirm B leaves the obligation FULFILLED while A remains permanently,
// correctly REJECTED. A payment's replay validity must be judged against
// its OWN row's internal consistency (terminal status + matching
// provenance + frozen amount/currency still agreeing with the
// obligation's frozen expectedAmount/currency), never against which of
// the obligation's two legitimate CURRENT states (OPEN or FULFILLED)
// happens to hold at replay time. See
// docs/product/susu-contribution-workflow-audit.md's "Historical payment
// state vs. current obligation state" section for the full writeup.
const CONTRIBUTION_PAYMENT_TRANSITIONS: Readonly<
  Record<ContributionPaymentStatus, readonly ContributionPaymentStatus[]>
> = {
  RECORDED: ["CONFIRMED", "REJECTED"],
  CONFIRMED: [],
  REJECTED: [],
};

export function isContributionPaymentTransitionAllowed(
  from: ContributionPaymentStatus,
  to: ContributionPaymentStatus,
): boolean {
  return CONTRIBUTION_PAYMENT_TRANSITIONS[from].includes(to);
}

// OPEN -> FULFILLED only, approved (7J.1) to be set atomically alongside
// the ContributionPayment row that confirms it. No writer may ever move an
// obligation back to OPEN -- once ledger-true (an exact-amount CONFIRMED
// payment exists), fulfillment cannot become false again, since CONFIRMED
// is itself terminal above and the partial unique index guarantees at
// most one CONFIRMED payment can ever exist per obligation.
const CONTRIBUTION_OBLIGATION_TRANSITIONS: Readonly<
  Record<ContributionObligationStatus, readonly ContributionObligationStatus[]>
> = {
  OPEN: ["FULFILLED"],
  FULFILLED: [],
};

export function isContributionObligationTransitionAllowed(
  from: ContributionObligationStatus,
  to: ContributionObligationStatus,
): boolean {
  return CONTRIBUTION_OBLIGATION_TRANSITIONS[from].includes(to);
}

/**
 * Documented (not implemented -- 7J.1 is domain/validation only) expected
 * behavior for the races and replays the future writers must handle. Kept
 * here, next to the transition contract itself, so a future service's own
 * tests can assert its behavior against these exact string keys rather
 * than against prose that can drift out of sync with the code.
 *
 * - "duplicate-recording-operation": a retried recordContributionPayment
 *   call with a clientOperationId that was already used for this circle
 *   must resolve to the SAME payment's outcome (idempotent replay), never
 *   insert a second row and never throw a raw uniqueness error to the
 *   caller.
 * - "duplicate-confirmation": a second confirmContributionPayment call
 *   against a payment that is no longer RECORDED (already CONFIRMED by a
 *   concurrent request) must be a safe no-op outcome for the caller, never
 *   a raw error -- detected via a conditional update affecting zero rows
 *   (WHERE status = 'RECORDED'), not via a separate read-then-write.
 * - "duplicate-rejection": symmetric to duplicate-confirmation, for
 *   rejectContributionPayment.
 * - "conflicting-terminal-decision": a confirm and a reject racing against
 *   the same RECORDED payment -- whichever conditional update commits
 *   first wins; the other observes zero affected rows and must treat that
 *   as "already resolved," never overwrite the winner's outcome.
 * - "fresh-attempt-after-rejection": once a payment is REJECTED, the
 *   partial unique index no longer covers it, so a new
 *   recordContributionPayment call against the same obligation (a new
 *   clientOperationId, a new row) is expected and permitted.
 * - "already-fulfilled-obligation": recordContributionPayment against an
 *   obligation that is already ledger-fulfilled (an exact-amount CONFIRMED
 *   payment already exists) must be rejected with a specific, friendly
 *   error at the service's own preflight check -- but this case is, in
 *   fact, already backstopped at the database level too: the partial
 *   unique index's WHERE clause covers CONFIRMED as well as RECORDED, so
 *   the existing CONFIRMED row already occupies that obligation's one
 *   slot, and a new RECORDED insert against it would violate the index
 *   exactly like any other duplicate-unresolved-payment race.
 */
export const CONTRIBUTION_REPLAY_CONTRACT_KEYS = [
  "duplicate-recording-operation",
  "duplicate-confirmation",
  "duplicate-rejection",
  "conflicting-terminal-decision",
  "fresh-attempt-after-rejection",
  "already-fulfilled-obligation",
] as const;
