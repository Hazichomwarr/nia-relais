import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { amountMatchesObligation } from "@/src/domain/contribution-accounting";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import { findObligationForConfirmation } from "@/src/repositories/contribution-confirmation.repository";
import { findCircleForContributionRecording } from "@/src/repositories/contribution-recording.repository";
import {
  findPaymentForRejection,
  rejectRecordedPayment,
  type ContributionPaymentForRejectionRecord,
} from "@/src/repositories/contribution-rejection.repository";
import { prisma } from "@/src/prisma";
import type { RejectContributionInput } from "@/src/validations/contribution.schema";

// Owner-operated SUSU contribution rejection (7J.4). Rejects an
// already-RECORDED ContributionPayment. Never confirms, never mutates
// ContributionObligation at all (rejection must not fulfill, reopen, or
// otherwise change it), never creates a new payment, never touches
// PayoutRound/SavingsCircle lifecycle -- those are out of scope.
//
// Structure mirrors contribution-confirmation.service.ts (7J.3) closely:
// an unlocked, fail-fast pre-check (ownership, then payment lookup, then a
// CONFIRMED/REJECTED short-circuit that never needs the lock) followed by
// a locked, authoritative transaction for a genuinely fresh rejection,
// which re-checks the same things once more under the lock before
// writing anything. The two services share the SAME circle-row lock, so a
// real confirm-vs-reject race on one payment is fully serialized by it --
// see contribution-confirmation.service.test.ts / this file's own test
// for the concurrency evidence.

export class ContributionRejectionCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "ContributionRejectionCircleNotFoundError";
  }
}

export class ContributionRejectionAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to reject contributions for this circle.");
    this.name = "ContributionRejectionAuthorizationError";
  }
}

export class ContributionRejectionCircleNotActiveError extends Error {
  constructor() {
    super("Contributions can only be rejected for an active circle.");
    this.name = "ContributionRejectionCircleNotActiveError";
  }
}

export class ContributionRejectionPaymentNotFoundError extends Error {
  constructor() {
    super("Contribution payment not found for this circle.");
    this.name = "ContributionRejectionPaymentNotFoundError";
  }
}

export class ContributionRejectionPaymentConfirmedError extends Error {
  constructor() {
    super("This payment was already confirmed and cannot be rejected.");
    this.name = "ContributionRejectionPaymentConfirmedError";
  }
}

export class ContributionRejectionObligationNotFoundError extends Error {
  constructor() {
    super("The obligation for this payment was not found for this circle.");
    this.name = "ContributionRejectionObligationNotFoundError";
  }
}

export class ContributionRejectionAmountIntegrityError extends Error {
  constructor() {
    super("This payment's amount no longer matches its obligation's expected amount.");
    this.name = "ContributionRejectionAmountIntegrityError";
  }
}

export class ContributionRejectionCurrencyIntegrityError extends Error {
  constructor() {
    super("This payment's currency no longer matches its obligation's currency.");
    this.name = "ContributionRejectionCurrencyIntegrityError";
  }
}

export class ContributionRejectionUnexpectedObligationStateError extends Error {
  constructor() {
    super("This obligation is not in a state consistent with rejecting this payment.");
    this.name = "ContributionRejectionUnexpectedObligationStateError";
  }
}

export class ContributionRejectionIntegrityConflictError extends Error {
  constructor() {
    super("This contribution's persisted state is inconsistent and cannot be safely rejected or replayed.");
    this.name = "ContributionRejectionIntegrityConflictError";
  }
}

export class ContributionRejectionIntentConflictError extends Error {
  constructor() {
    super("This payment was already rejected for a different reason.");
    this.name = "ContributionRejectionIntentConflictError";
  }
}

export class InvalidRejectionReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRejectionReasonError";
  }
}

export type RejectedContributionResult = {
  readonly id: string;
  readonly circleId: string;
  readonly obligationId: string;
  readonly amount: string;
  readonly currency: string;
  // Narrowed to "REJECTED", same reasoning as
  // contribution-confirmation.service.ts's "CONFIRMED" narrowing: every
  // path that returns a result here has, by construction, already
  // established the payment is REJECTED -- a CONFIRMED payment is always
  // a thrown terminal conflict, never a returned result.
  readonly status: "REJECTED";
  readonly recordedAt: string;
  readonly recordedById: string;
  readonly rejectedAt: string;
  readonly rejectedById: string;
  readonly rejectionReason: string;
};

type Client = PrismaClient | Prisma.TransactionClient;

function serializeRejectedContribution(payment: {
  id: string;
  circleId: string;
  obligationId: string;
  amount: Prisma.Decimal;
  currency: string;
  recordedAt: Date;
  recordedById: string;
  rejectedAt: Date;
  rejectedById: string;
  rejectionReason: string;
}): RejectedContributionResult {
  return {
    id: payment.id,
    circleId: payment.circleId,
    obligationId: payment.obligationId,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    status: "REJECTED",
    recordedAt: payment.recordedAt.toISOString(),
    recordedById: payment.recordedById,
    rejectedAt: payment.rejectedAt.toISOString(),
    rejectedById: payment.rejectedById,
    rejectionReason: payment.rejectionReason,
  };
}

/**
 * Defensive, service-owned re-check that the reason is a real, non-empty,
 * bounded string -- mirrors contribution-recording.service.ts's own
 * defensive re-parse of amount. rejectContributionSchema already enforces
 * this at the future Server Action boundary; client-side/schema
 * validation passing is never treated as authoritative here either.
 */
function assertValidReason(rejectionReason: string): string {
  const trimmed = rejectionReason.trim();
  if (trimmed.length === 0) throw new InvalidRejectionReasonError("Enter a rejection reason.");
  if (trimmed.length > 500) throw new InvalidRejectionReasonError("Rejection reason must be 500 characters or fewer.");
  return trimmed;
}

/**
 * Resolves an already-REJECTED payment as a safe, exact-intent replay
 * (7J.4 section 7): the obligation must still be genuinely OPEN and every
 * persisted financial fact must still agree (case: consistent), AND the
 * supplied reason must exactly match the persisted one -- a reused
 * confirmation attempt with a DIFFERENT reason is a distinct conflict,
 * never a silent overwrite of the original reason (prefer exact-intent
 * replay, per the ticket). Any other inconsistency (obligation not OPEN,
 * missing rejectedAt/rejectedById/rejectionReason, amount/currency drift)
 * is an integrity conflict, never repaired.
 */
async function resolveRejectedReplay(
  client: Client,
  circleId: string,
  payment: ContributionPaymentForRejectionRecord,
  suppliedReason: string,
): Promise<RejectedContributionResult> {
  const obligation = await findObligationForConfirmation(client, circleId, payment.obligationId);
  if (!obligation) throw new ContributionRejectionObligationNotFoundError();

  // 7J.4.1 correction: a REJECTED payment's historical validity does NOT
  // depend on its obligation remaining OPEN forever. The legitimate
  // sequence record A -> reject A -> record B -> confirm B leaves the
  // obligation FULFILLED while A remains permanently, correctly REJECTED
  // -- replaying A's rejection after that must still succeed. So this
  // check is scoped to two things ONLY: (1) this payment's OWN historical
  // consistency (rejection provenance complete, no contradictory
  // confirmation provenance on the SAME row -- a payment is terminal in
  // exactly one direction per contribution-state.ts, so a REJECTED row
  // that also carries confirmedAt/confirmedById is corrupted data) and
  // (2) its frozen amount/currency still agreeing with the obligation's
  // own frozen expectedAmount/currency, which does not change with
  // fulfillment. The obligation's CURRENT status/fulfilledAt is
  // deliberately NOT gated on being OPEN -- only checked for its own
  // internal consistency (FULFILLED must carry a fulfilledAt; OPEN must
  // not), independent of which of the two legitimate states it is in.
  const paymentConsistent =
    payment.rejectedAt !== null &&
    payment.rejectedById !== null &&
    payment.rejectionReason !== null &&
    payment.confirmedAt === null &&
    payment.confirmedById === null &&
    amountMatchesObligation(payment.amount, obligation.expectedAmount) &&
    payment.currency === obligation.currency;

  const obligationInternallyConsistent =
    (obligation.status === "FULFILLED" && obligation.fulfilledAt !== null) ||
    (obligation.status === "OPEN" && obligation.fulfilledAt === null);

  if (!paymentConsistent || !obligationInternallyConsistent) {
    throw new ContributionRejectionIntegrityConflictError();
  }
  if (payment.rejectionReason !== suppliedReason) {
    throw new ContributionRejectionIntentConflictError();
  }

  return serializeRejectedContribution({
    ...payment,
    rejectedAt: payment.rejectedAt as Date,
    rejectedById: payment.rejectedById as string,
    rejectionReason: payment.rejectionReason as string,
  });
}

/**
 * Rejects one owner-recorded ContributionPayment. Never touches
 * ContributionObligation -- rejection releases the partial unique index's
 * slot for the obligation simply by moving the payment's own status out
 * of ('RECORDED', 'CONFIRMED'), with no write to the obligation row
 * required or performed.
 *
 * Ownership is checked twice for the same reason as the recording/
 * confirmation services: unlocked up front (fail fast, and required
 * before the CONFIRMED/REJECTED short-circuits below can safely run) and
 * again inside the locked transaction for a genuinely fresh rejection.
 *
 * A REJECTED replay is resolved BEFORE the ACTIVE check and without
 * taking the circle lock -- it must succeed even if the circle has since
 * become COMPLETED or ARCHIVED (7J.4 section 7). A CONFIRMED payment is a
 * terminal conflict, also checked unconditionally, also without the lock.
 */
export async function rejectContribution(params: {
  ownerId: string;
  circleId: string;
  input: RejectContributionInput;
}): Promise<RejectedContributionResult> {
  const { ownerId, circleId, input } = params;
  const { paymentId } = input;
  const rejectionReason = assertValidReason(input.rejectionReason);

  const circle = await findCircleForContributionRecording(prisma, circleId);
  if (!circle) throw new ContributionRejectionCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new ContributionRejectionAuthorizationError();

  const existingPayment = await findPaymentForRejection(prisma, circleId, paymentId);
  if (!existingPayment) throw new ContributionRejectionPaymentNotFoundError();

  if (existingPayment.status === "REJECTED") {
    return resolveRejectedReplay(prisma, circleId, existingPayment, rejectionReason);
  }
  if (existingPayment.status === "CONFIRMED") {
    throw new ContributionRejectionPaymentConfirmedError();
  }

  if (circle.status !== "ACTIVE") throw new ContributionRejectionCircleNotActiveError();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new ContributionRejectionCircleNotFoundError();

    const freshCircle = await findCircleForContributionRecording(transaction, circleId);
    if (!freshCircle) throw new ContributionRejectionCircleNotFoundError();
    if (freshCircle.ownerId !== ownerId) throw new ContributionRejectionAuthorizationError();

    const payment = await findPaymentForRejection(transaction, circleId, paymentId);
    if (!payment) throw new ContributionRejectionPaymentNotFoundError();

    // Re-check under the lock: another concurrent request -- a duplicate
    // rejection, OR a competing confirmContribution call -- may have
    // already committed a terminal transition between our unlocked read
    // above and this transaction acquiring the lock.
    if (payment.status === "REJECTED") {
      return resolveRejectedReplay(transaction, circleId, payment, rejectionReason);
    }
    if (payment.status === "CONFIRMED") {
      throw new ContributionRejectionPaymentConfirmedError();
    }

    if (freshCircle.status !== "ACTIVE") throw new ContributionRejectionCircleNotActiveError();

    const obligation = await findObligationForConfirmation(transaction, circleId, payment.obligationId);
    if (!obligation) throw new ContributionRejectionObligationNotFoundError();

    // Ledger-integrity checks (mirrors 7J.3 section 6): fail safely,
    // before any write, rather than repair anything automatically.
    if (!amountMatchesObligation(payment.amount, obligation.expectedAmount)) {
      throw new ContributionRejectionAmountIntegrityError();
    }
    if (payment.currency !== obligation.currency) {
      throw new ContributionRejectionCurrencyIntegrityError();
    }
    if (obligation.status !== "OPEN") {
      throw new ContributionRejectionUnexpectedObligationStateError();
    }

    const rejectedAt = new Date();
    const transition = await rejectRecordedPayment(transaction, {
      paymentId,
      circleId,
      rejectedAt,
      rejectedById: ownerId,
      rejectionReason,
    });
    if (transition.count !== 1) {
      // Never guess: re-read fresh state and resolve it properly. Under
      // the row lock this branch should be unreachable (nothing else can
      // have changed the payment between our own read above and this
      // write), but the CAS contract is honored regardless.
      const fresh = await findPaymentForRejection(transaction, circleId, paymentId);
      if (!fresh) throw new ContributionRejectionPaymentNotFoundError();
      if (fresh.status === "REJECTED") return resolveRejectedReplay(transaction, circleId, fresh, rejectionReason);
      if (fresh.status === "CONFIRMED") throw new ContributionRejectionPaymentConfirmedError();
      throw new ContributionRejectionIntegrityConflictError();
    }

    // No obligation write -- rejection must never touch it (7J.4 section
    // 5). The obligation stays OPEN, released for a fresh recording
    // attempt purely by the payment's own status leaving
    // ('RECORDED', 'CONFIRMED').
    return serializeRejectedContribution({
      ...payment,
      rejectedAt,
      rejectedById: ownerId,
      rejectionReason,
    });
  });
}
