import "server-only";

import { Prisma } from "@prisma/client";

import { amountMatchesObligation, toMoney } from "@/src/domain/contribution-accounting";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  createRecordedContributionPayment,
  findActiveOrConfirmedPaymentForObligation,
  findCircleForContributionRecording,
  findContributionPaymentByOperationId,
  findObligationForRecording,
  type ContributionPaymentRecord,
} from "@/src/repositories/contribution-recording.repository";
import { prisma } from "@/src/prisma";
import type { RecordContributionInput } from "@/src/validations/contribution.schema";

// Owner-operated SUSU contribution recording (7J.2). Records ONE
// RECORDED ContributionPayment against a frozen obligation. Never
// confirms, never rejects, never marks an obligation FULFILLED, never
// creates or changes a round -- those are out of scope for this ticket
// (7J.4+). Ownership is trusted from the caller (requireUser() at the
// future Server Action boundary, never member-session identity) -- this
// service still independently re-verifies it, twice (see below), rather
// than assuming the caller got it right.
//
// Structure mirrors deposit.service.ts's own createDeposit, the closest
// existing precedent for "owner-operated financial write with
// clientOperationId idempotency": an unlocked, fail-fast pre-check
// (ownership, then idempotent replay -- which must succeed even if the
// circle is no longer ACTIVE, per 7J.2 section 6) followed by a locked,
// authoritative transaction for a genuinely new recording, followed by a
// catch block that reconciles a genuine race caught as a Postgres unique
// violation (P2002) rather than leaking it to the caller.

export class ContributionRecordingCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "ContributionRecordingCircleNotFoundError";
  }
}

export class ContributionRecordingAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to record contributions for this circle.");
    this.name = "ContributionRecordingAuthorizationError";
  }
}

export class ContributionRecordingCircleNotActiveError extends Error {
  constructor() {
    super("Contributions can only be recorded for an active circle.");
    this.name = "ContributionRecordingCircleNotActiveError";
  }
}

export class ContributionObligationNotFoundError extends Error {
  constructor() {
    super("Contribution obligation not found for this circle.");
    this.name = "ContributionObligationNotFoundError";
  }
}

export class InvalidContributionAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContributionAmountError";
  }
}

export class ContributionAmountMismatchError extends Error {
  constructor() {
    super("The amount must exactly match this obligation's expected contribution.");
    this.name = "ContributionAmountMismatchError";
  }
}

export class ContributionObligationAlreadyFulfilledError extends Error {
  constructor() {
    super("This obligation has already been fulfilled by a confirmed payment.");
    this.name = "ContributionObligationAlreadyFulfilledError";
  }
}

export class ContributionObligationAlreadyRecordedError extends Error {
  constructor() {
    super("This obligation already has a recorded payment awaiting confirmation or rejection.");
    this.name = "ContributionObligationAlreadyRecordedError";
  }
}

export class ContributionOperationConflictError extends Error {
  constructor() {
    super("This operation identifier was already used for a different contribution.");
    this.name = "ContributionOperationConflictError";
  }
}

export class ContributionRecordingConflictError extends Error {
  constructor() {
    super("This contribution could not be recorded due to a conflicting concurrent change.");
    this.name = "ContributionRecordingConflictError";
  }
}

export type RecordedContributionResult = {
  readonly id: string;
  readonly circleId: string;
  readonly obligationId: string;
  readonly amount: string;
  readonly currency: string;
  // Not narrowed to "RECORDED": an idempotent replay (see section 6 of
  // this ticket) can surface a payment that has since been CONFIRMED or
  // REJECTED by a later, separate operation -- reporting its true current
  // status here is honest and required; it must never be misrepresented
  // as freshly RECORDED just because this call is the recording service.
  readonly status: "RECORDED" | "CONFIRMED" | "REJECTED";
  readonly clientOperationId: string;
  readonly recordedAt: string;
  readonly recordedById: string;
};

/**
 * Defensive, service-owned re-parse of the amount string into an exact
 * Prisma.Decimal -- deliberately re-validates shape (no floating point,
 * <=2 decimal places, fits DECIMAL(18,2), strictly positive) even though
 * recordContributionSchema already enforces the same rule at the future
 * Server Action boundary. Mirrors deposit.service.ts's own local
 * toMoney(value: string) exactly; client-side/schema validation passing
 * is never treated as authoritative for money (ticket section 3).
 */
function parseAmount(value: string): Prisma.Decimal {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new InvalidContributionAmountError("Amount must have no more than two decimal places.");
  }

  const [whole] = value.split(".");
  if (whole.length > 16) {
    throw new InvalidContributionAmountError("Amount must fit DECIMAL(18,2).");
  }

  const amount = new Prisma.Decimal(value);
  if (!amount.gt(0)) {
    throw new InvalidContributionAmountError("Amount must be greater than zero.");
  }

  return amount;
}

function serializeRecordedContribution(payment: ContributionPaymentRecord): RecordedContributionResult {
  return {
    id: payment.id,
    circleId: payment.circleId,
    obligationId: payment.obligationId,
    amount: toMoney(payment.amount),
    currency: payment.currency,
    status: payment.status,
    clientOperationId: payment.clientOperationId,
    recordedAt: payment.recordedAt.toISOString(),
    recordedById: payment.recordedById,
  };
}

/**
 * A clientOperationId match is only a legitimate replay if it also
 * targets the SAME obligation for the SAME amount -- ticket section 6/7:
 * a reused operation id with different financial intent must never be
 * silently treated as the same operation. A genuine replay is returned
 * as-is (whatever its CURRENT status now is -- see RecordedContributionResult);
 * anything else is a conflict.
 */
function reconcileReplay(
  existing: ContributionPaymentRecord,
  input: RecordContributionInput,
  amount: Prisma.Decimal,
): ContributionPaymentRecord {
  if (existing.obligationId !== input.obligationId || !existing.amount.equals(amount)) {
    throw new ContributionOperationConflictError();
  }
  return existing;
}

function isClientOperationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Records an owner-submitted contribution against one frozen
 * ContributionObligation. Only ever inserts a RECORDED row -- confirming,
 * rejecting, marking FULFILLED, and touching PayoutRound/SavingsCircle
 * lifecycle are all explicitly out of scope (7J.4+).
 *
 * Ownership is verified twice: once unlocked, up front (fail fast, and
 * needed before the idempotency check below can safely run), and again
 * inside the locked transaction for any genuinely new recording (the
 * authoritative check -- ownerId itself never changes post-creation, but
 * circle.status can, so the second read must be fresh and lock-held).
 *
 * Idempotent replay (matching clientOperationId, same obligation, same
 * amount) is resolved BEFORE the ACTIVE check and without taking the
 * circle lock at all -- a legitimate retry of an already-recorded
 * operation must succeed even if the circle is no longer ACTIVE and even
 * if the original payment has since been CONFIRMED or REJECTED by a
 * separate operation (ticket section 6).
 */
export async function recordContribution(params: {
  ownerId: string;
  circleId: string;
  input: RecordContributionInput;
}): Promise<RecordedContributionResult> {
  const { ownerId, circleId, input } = params;

  const circle = await findCircleForContributionRecording(prisma, circleId);
  if (!circle) throw new ContributionRecordingCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new ContributionRecordingAuthorizationError();

  const amount = parseAmount(input.amount);

  const existingByOperation = await findContributionPaymentByOperationId(
    prisma,
    circleId,
    input.clientOperationId,
  );
  if (existingByOperation) {
    return serializeRecordedContribution(reconcileReplay(existingByOperation, input, amount));
  }

  if (circle.status !== "ACTIVE") throw new ContributionRecordingCircleNotActiveError();

  try {
    const payment = await prisma.$transaction(async (transaction) => {
      const locked = await lockSavingsCircleForUpdate(transaction, circleId);
      if (!locked) throw new ContributionRecordingCircleNotFoundError();

      const freshCircle = await findCircleForContributionRecording(transaction, circleId);
      if (!freshCircle) throw new ContributionRecordingCircleNotFoundError();
      if (freshCircle.ownerId !== ownerId) throw new ContributionRecordingAuthorizationError();

      // Re-check idempotency UNDER the lock: the pre-transaction check
      // above cannot see another request's still-in-flight insert, so two
      // truly concurrent submissions of the SAME operation both pass it.
      // The row lock serializes them -- whichever acquires it second sees
      // the first's now-committed row here and reconciles as a replay,
      // rather than falling through to the "already recorded" conflict
      // below (which is for a DIFFERENT operation id racing for the same
      // obligation's slot, not this one).
      const existingInTransaction = await findContributionPaymentByOperationId(transaction, circleId, input.clientOperationId);
      if (existingInTransaction) {
        return reconcileReplay(existingInTransaction, input, amount);
      }

      if (freshCircle.status !== "ACTIVE") throw new ContributionRecordingCircleNotActiveError();

      // Scoped by (id, circleId) -- structurally guarantees this
      // obligation's own round/member relationships already belong to
      // this same circle (see the repository's own doc comment). No
      // round-status or due-date check: 7J.1's approved eligibility rule
      // is that any persisted round accepts late/catch-up contributions,
      // and due dates neither authorize nor prohibit recording.
      const obligation = await findObligationForRecording(transaction, circleId, input.obligationId);
      if (!obligation) throw new ContributionObligationNotFoundError();

      if (!amountMatchesObligation(amount, obligation.expectedAmount)) {
        throw new ContributionAmountMismatchError();
      }

      // Friendly preflight for "already fulfilled" / "already recorded" --
      // backstopped atomically by the partial unique index on insert
      // below, which covers RECORDED and CONFIRMED identically (a
      // CONFIRMED row already occupies the obligation's one slot, so a
      // fulfilled obligation is rejected here too, not just a pending one).
      const activeOrConfirmed = await findActiveOrConfirmedPaymentForObligation(
        transaction,
        circleId,
        obligation.id,
      );
      if (activeOrConfirmed) {
        throw activeOrConfirmed.status === "CONFIRMED"
          ? new ContributionObligationAlreadyFulfilledError()
          : new ContributionObligationAlreadyRecordedError();
      }

      return createRecordedContributionPayment(transaction, {
        circleId,
        obligationId: obligation.id,
        amount,
        currency: obligation.currency,
        clientOperationId: input.clientOperationId,
        recordedById: ownerId,
      });
    });

    return serializeRecordedContribution(payment);
  } catch (error) {
    if (!isClientOperationConflict(error)) throw error;

    // A genuine race was caught at the database level. Reconcile without
    // ever inspecting the raw constraint name: re-check both unique
    // indexes this table has, exactly the two this transaction could have
    // collided with.
    const raced = await findContributionPaymentByOperationId(prisma, circleId, input.clientOperationId);
    if (raced) {
      return serializeRecordedContribution(reconcileReplay(raced, input, amount));
    }

    const activeOrConfirmed = await findActiveOrConfirmedPaymentForObligation(
      prisma,
      circleId,
      input.obligationId,
    );
    if (activeOrConfirmed) {
      throw activeOrConfirmed.status === "CONFIRMED"
        ? new ContributionObligationAlreadyFulfilledError()
        : new ContributionObligationAlreadyRecordedError();
    }

    throw new ContributionRecordingConflictError();
  }
}
