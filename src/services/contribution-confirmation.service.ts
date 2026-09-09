import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { amountMatchesObligation } from "@/src/domain/contribution-accounting";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  confirmRecordedPayment,
  findObligationForConfirmation,
  findPaymentForConfirmation,
  fulfillOpenObligation,
  type ContributionPaymentForConfirmationRecord,
} from "@/src/repositories/contribution-confirmation.repository";
import { findCircleForContributionRecording } from "@/src/repositories/contribution-recording.repository";
import { prisma } from "@/src/prisma";
import type { ConfirmContributionInput } from "@/src/validations/contribution.schema";

// Owner-operated SUSU contribution confirmation (7J.3). Confirms an
// already-RECORDED ContributionPayment and, in the SAME transaction,
// marks its ContributionObligation FULFILLED. Never rejects, never
// creates a new ContributionPayment, never touches PayoutRound/
// SavingsCircle lifecycle -- those are out of scope (7J.4+).
//
// Structure mirrors contribution-recording.service.ts (7J.2) closely: an
// unlocked, fail-fast pre-check (ownership, then payment lookup, then a
// REJECTED/CONFIRMED short-circuit that never needs the lock) followed by
// a locked, authoritative transaction for a genuinely fresh confirmation,
// which re-checks the same things once more under the lock before
// writing anything.

export class ContributionConfirmationCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "ContributionConfirmationCircleNotFoundError";
  }
}

export class ContributionConfirmationAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to confirm contributions for this circle.");
    this.name = "ContributionConfirmationAuthorizationError";
  }
}

export class ContributionConfirmationCircleNotActiveError extends Error {
  constructor() {
    super("Contributions can only be confirmed for an active circle.");
    this.name = "ContributionConfirmationCircleNotActiveError";
  }
}

export class ContributionConfirmationPaymentNotFoundError extends Error {
  constructor() {
    super("Contribution payment not found for this circle.");
    this.name = "ContributionConfirmationPaymentNotFoundError";
  }
}

export class ContributionConfirmationPaymentRejectedError extends Error {
  constructor() {
    super("This payment was rejected and cannot be confirmed.");
    this.name = "ContributionConfirmationPaymentRejectedError";
  }
}

export class ContributionConfirmationObligationNotFoundError extends Error {
  constructor() {
    super("The obligation for this payment was not found for this circle.");
    this.name = "ContributionConfirmationObligationNotFoundError";
  }
}

export class ContributionConfirmationAmountIntegrityError extends Error {
  constructor() {
    super("This payment's amount no longer matches its obligation's expected amount.");
    this.name = "ContributionConfirmationAmountIntegrityError";
  }
}

export class ContributionConfirmationCurrencyIntegrityError extends Error {
  constructor() {
    super("This payment's currency no longer matches its obligation's currency.");
    this.name = "ContributionConfirmationCurrencyIntegrityError";
  }
}

export class ContributionConfirmationUnexpectedObligationStateError extends Error {
  constructor() {
    super("This obligation is not in a state that can be fulfilled by confirming this payment.");
    this.name = "ContributionConfirmationUnexpectedObligationStateError";
  }
}

export class ContributionConfirmationIntegrityConflictError extends Error {
  constructor() {
    super("This contribution's persisted state is inconsistent and cannot be safely confirmed or replayed.");
    this.name = "ContributionConfirmationIntegrityConflictError";
  }
}

export type ConfirmedContributionResult = {
  readonly payment: {
    readonly id: string;
    readonly circleId: string;
    readonly obligationId: string;
    readonly amount: string;
    readonly currency: string;
    // Narrowed to "CONFIRMED", unlike contribution-recording.service.ts's
    // wider status union: every path that returns a result here (a fresh
    // confirmation or a safe replay) has, by construction, already
    // established the payment is CONFIRMED -- a REJECTED payment is
    // always a thrown terminal conflict, never a returned result.
    readonly status: "CONFIRMED";
    readonly recordedAt: string;
    readonly recordedById: string;
    readonly confirmedAt: string;
    readonly confirmedById: string;
  };
  readonly obligation: {
    readonly id: string;
    readonly status: "FULFILLED";
    readonly fulfilledAt: string;
  };
};

type Client = PrismaClient | Prisma.TransactionClient;

function serializeConfirmedContribution(
  payment: {
    id: string;
    circleId: string;
    obligationId: string;
    amount: Prisma.Decimal;
    currency: string;
    recordedAt: Date;
    recordedById: string;
    confirmedAt: Date;
    confirmedById: string;
  },
  obligation: { id: string; fulfilledAt: Date },
): ConfirmedContributionResult {
  return {
    payment: {
      id: payment.id,
      circleId: payment.circleId,
      obligationId: payment.obligationId,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      status: "CONFIRMED",
      recordedAt: payment.recordedAt.toISOString(),
      recordedById: payment.recordedById,
      confirmedAt: payment.confirmedAt.toISOString(),
      confirmedById: payment.confirmedById,
    },
    obligation: {
      id: obligation.id,
      status: "FULFILLED",
      fulfilledAt: obligation.fulfilledAt.toISOString(),
    },
  };
}

/**
 * Resolves an already-CONFIRMED payment as either a safe replay (case A,
 * 7J.3 section 7: the obligation is genuinely FULFILLED and every
 * persisted financial fact still agrees) or an integrity conflict (case
 * B: CONFIRMED next to an OPEN obligation, a missing fulfilledAt/
 * confirmedAt, or a since-corrupted amount/currency). Never repairs
 * anything -- only ever reads and either returns or throws.
 */
async function resolveConfirmedReplay(
  client: Client,
  circleId: string,
  payment: ContributionPaymentForConfirmationRecord,
): Promise<ConfirmedContributionResult> {
  const obligation = await findObligationForConfirmation(client, circleId, payment.obligationId);
  if (!obligation) throw new ContributionConfirmationObligationNotFoundError();

  const consistent =
    obligation.status === "FULFILLED" &&
    obligation.fulfilledAt !== null &&
    payment.confirmedAt !== null &&
    payment.confirmedById !== null &&
    amountMatchesObligation(payment.amount, obligation.expectedAmount) &&
    payment.currency === obligation.currency;

  if (!consistent) {
    throw new ContributionConfirmationIntegrityConflictError();
  }

  return serializeConfirmedContribution(
    {
      ...payment,
      confirmedAt: payment.confirmedAt as Date,
      confirmedById: payment.confirmedById as string,
    },
    { id: obligation.id, fulfilledAt: obligation.fulfilledAt as Date },
  );
}

/**
 * Confirms one owner-recorded ContributionPayment, atomically marking its
 * obligation FULFILLED in the same transaction. Ownership is checked
 * twice for the same reason as contribution-recording.service.ts:
 * unlocked up front (fail fast, and required before the CONFIRMED/
 * REJECTED short-circuits below can safely run) and again inside the
 * locked transaction for a genuinely fresh confirmation (circle.status
 * can change concurrently; ownerId cannot).
 *
 * A CONFIRMED replay is resolved BEFORE the ACTIVE check and without
 * taking the circle lock -- it must succeed even if the circle has since
 * become COMPLETED or ARCHIVED (7J.3 section 7). A REJECTED payment is a
 * terminal conflict, also checked unconditionally, also without the lock.
 */
export async function confirmContribution(params: {
  ownerId: string;
  circleId: string;
  input: ConfirmContributionInput;
}): Promise<ConfirmedContributionResult> {
  const { ownerId, circleId, input } = params;
  const { paymentId } = input;

  const circle = await findCircleForContributionRecording(prisma, circleId);
  if (!circle) throw new ContributionConfirmationCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new ContributionConfirmationAuthorizationError();

  const existingPayment = await findPaymentForConfirmation(prisma, circleId, paymentId);
  if (!existingPayment) throw new ContributionConfirmationPaymentNotFoundError();

  if (existingPayment.status === "CONFIRMED") {
    return resolveConfirmedReplay(prisma, circleId, existingPayment);
  }
  if (existingPayment.status === "REJECTED") {
    throw new ContributionConfirmationPaymentRejectedError();
  }

  if (circle.status !== "ACTIVE") throw new ContributionConfirmationCircleNotActiveError();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new ContributionConfirmationCircleNotFoundError();

    const freshCircle = await findCircleForContributionRecording(transaction, circleId);
    if (!freshCircle) throw new ContributionConfirmationCircleNotFoundError();
    if (freshCircle.ownerId !== ownerId) throw new ContributionConfirmationAuthorizationError();

    const payment = await findPaymentForConfirmation(transaction, circleId, paymentId);
    if (!payment) throw new ContributionConfirmationPaymentNotFoundError();

    // Re-check under the lock: another concurrent confirmContribution call
    // for the SAME payment may have already committed between our
    // unlocked read above and this transaction acquiring the lock (same
    // reason 7J.2's recordContribution re-checks idempotency inside its
    // own transaction).
    if (payment.status === "CONFIRMED") {
      return resolveConfirmedReplay(transaction, circleId, payment);
    }
    if (payment.status === "REJECTED") {
      throw new ContributionConfirmationPaymentRejectedError();
    }

    if (freshCircle.status !== "ACTIVE") throw new ContributionConfirmationCircleNotActiveError();

    const obligation = await findObligationForConfirmation(transaction, circleId, payment.obligationId);
    if (!obligation) throw new ContributionConfirmationObligationNotFoundError();

    // Ledger-integrity checks (7J.3 section 6): recordContribution already
    // enforces exact-amount at insert time, but confirmation must not
    // blindly trust that historical data is still intact. Fail safely,
    // before any write, rather than repair anything automatically.
    if (!amountMatchesObligation(payment.amount, obligation.expectedAmount)) {
      throw new ContributionConfirmationAmountIntegrityError();
    }
    if (payment.currency !== obligation.currency) {
      throw new ContributionConfirmationCurrencyIntegrityError();
    }
    if (obligation.status !== "OPEN") {
      throw new ContributionConfirmationUnexpectedObligationStateError();
    }

    const confirmedAt = new Date();
    const paymentTransition = await confirmRecordedPayment(transaction, {
      paymentId,
      circleId,
      confirmedAt,
      confirmedById: ownerId,
    });
    if (paymentTransition.count !== 1) {
      // Never guess: re-read fresh state and resolve it properly. Under
      // the row lock this branch should be unreachable (nothing else can
      // have changed the payment between our own read above and this
      // write), but the CAS contract is honored regardless -- see the
      // repository's own doc comment.
      const fresh = await findPaymentForConfirmation(transaction, circleId, paymentId);
      if (!fresh) throw new ContributionConfirmationPaymentNotFoundError();
      if (fresh.status === "CONFIRMED") return resolveConfirmedReplay(transaction, circleId, fresh);
      if (fresh.status === "REJECTED") throw new ContributionConfirmationPaymentRejectedError();
      throw new ContributionConfirmationIntegrityConflictError();
    }

    const obligationTransition = await fulfillOpenObligation(transaction, {
      obligationId: obligation.id,
      circleId,
      fulfilledAt: confirmedAt,
    });
    if (obligationTransition.count !== 1) {
      // Throwing here rolls back the payment CAS above too (same
      // transaction) -- the payment is left RECORDED, never CONFIRMED
      // next to an obligation that failed to become FULFILLED.
      throw new ContributionConfirmationIntegrityConflictError();
    }

    return serializeConfirmedContribution(
      { ...payment, confirmedAt, confirmedById: ownerId },
      { id: obligation.id, fulfilledAt: confirmedAt },
    );
  });
}
