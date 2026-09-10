import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { toMoney } from "@/src/domain/contribution-accounting";
import {
  amountMatchesExpectedPayout,
  computeExpectedPayoutAmount,
  type ExpectedPayoutAmount,
} from "@/src/domain/payout-accounting";
import type { PayoutStatus } from "@/src/domain/payout-state";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  createRecordedPayout,
  findCircleForPayoutRecording,
  findPayoutByOperationId,
  findPayoutByRoundId,
  findRoundForPayoutRecording,
  findRoundObligationsForPayout,
  type PayoutRecord,
} from "@/src/repositories/payout-recording.repository";
import { prisma } from "@/src/prisma";
import type { RecordPayoutInput } from "@/src/validations/payout.schema";

// Owner-operated SUSU payout recording (7K.3). Records the owner's
// historical assertion that a payout for one persisted round was made
// EXTERNALLY -- exactly ONE RECORDED Payout row, for the life of that
// round. Never confirms, never disputes, never closes a round, never
// completes a circle, never executes or integrates a payment; those are
// 7K.4+ and a separate lifecycle slice entirely (7K.1 sign-off items 8/10).
//
// Structure deliberately mirrors contribution-recording.service.ts, the
// proven precedent for "owner-operated financial write with
// clientOperationId idempotency": an unlocked, fail-fast pre-check
// (ownership, then idempotent replay -- which must resolve even if the
// circle is no longer ACTIVE, per 7K.1 item 6), then a locked,
// authoritative transaction for a genuinely new recording, then a catch
// block that reconciles a real race caught as a Postgres unique violation
// rather than leaking it.
//
// The two things this service does that recordContribution does not, both
// forced by 7K.1 item 1:
//
//  1. The authoritative amount is not a single frozen field. It is the
//     exact Decimal SUM of every persisted ContributionObligation
//     .expectedAmount for the round (computeExpectedPayoutAmount), read
//     fresh under the circle-row lock. Never the live CircleMember count,
//     never payoutOrder, never circle.contributionAmount x live
//     membership, never PayoutRound.status, never a due date.
//  2. The persisted currency comes from that same obligation set, never
//     from client input (the client cannot even supply one -- see
//     recordPayoutSchema).
//
// Payout's @@unique([roundId]) is FULL, not partial (7K audit section 6):
// there is no "slot released by a terminal outcome" the way a REJECTED
// ContributionPayment releases its partial index. So a second recording
// for a round is impossible whether the existing payout is RECORDED,
// CONFIRMED or DISPUTED -- and this service never updates, replaces or
// deletes an existing Payout row under any circumstance.

export class PayoutRecordingCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "PayoutRecordingCircleNotFoundError";
  }
}

export class PayoutRecordingAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to record payouts for this circle.");
    this.name = "PayoutRecordingAuthorizationError";
  }
}

export class PayoutRecordingCircleNotActiveError extends Error {
  constructor() {
    super("Payouts can only be recorded for an active circle.");
    this.name = "PayoutRecordingCircleNotActiveError";
  }
}

export class PayoutRecordingRoundNotFoundError extends Error {
  constructor() {
    super("Payout round not found for this circle.");
    this.name = "PayoutRecordingRoundNotFoundError";
  }
}

export class InvalidPayoutAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayoutAmountError";
  }
}

export class PayoutAmountMismatchError extends Error {
  constructor() {
    super("The amount must exactly match this round's expected payout.");
    this.name = "PayoutAmountMismatchError";
  }
}

export class PayoutRecordingOperationConflictError extends Error {
  constructor() {
    super("This operation identifier was already used for a different payout.");
    this.name = "PayoutRecordingOperationConflictError";
  }
}

export class PayoutAlreadyRecordedError extends Error {
  constructor() {
    super("A payout has already been recorded for this round.");
    this.name = "PayoutAlreadyRecordedError";
  }
}

export class PayoutRecordingIntegrityConflictError extends Error {
  constructor() {
    super("This payout's persisted history is inconsistent and cannot be replayed.");
    this.name = "PayoutRecordingIntegrityConflictError";
  }
}

export class PayoutRecordingConflictError extends Error {
  constructor() {
    super("This payout could not be recorded due to a conflicting concurrent change.");
    this.name = "PayoutRecordingConflictError";
  }
}

// Re-exported so a caller (a future 7K.5 Server Action) can catch the whole
// payout-recording error surface from this one module without also needing
// to import the domain layer. The accounting integrity failure -- an empty
// or currency-inconsistent obligation set for the round -- is raised
// unchanged from src/domain/payout-accounting.ts rather than re-wrapped
// here, because that failure is intrinsic to the accounting rule itself and
// is identical for every future consumer of it (that module's own comment).
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type RecordedPayoutResult = {
  readonly id: string;
  readonly circleId: string;
  readonly roundId: string;
  readonly amount: string;
  readonly currency: string;
  // Not narrowed to "RECORDED": an idempotent replay can legitimately
  // surface a payout the recipient has since terminally CONFIRMED or
  // DISPUTED (7K.1 item 6). Reporting its true current status here is
  // required -- a replay must never misrepresent a terminally decided
  // payout as freshly RECORDED, and must never reset it to RECORDED.
  readonly status: PayoutStatus;
  readonly clientOperationId: string;
  readonly recordedAt: string;
  readonly recordedById: string;
};

// Local copy of PayoutStatus's own three values, used only as a defensive
// runtime check that a persisted row carries a status this V1 contract
// actually knows (src/domain/payout-state.ts owns the type and the
// transitions; this is not a second transition table).
const KNOWN_PAYOUT_STATUSES: readonly PayoutStatus[] = ["RECORDED", "CONFIRMED", "DISPUTED"];

/**
 * Defensive, service-owned re-parse of the amount string into an exact
 * Prisma.Decimal -- deliberately re-validates shape (no floating point,
 * <=2 decimal places, fits DECIMAL(18,2), strictly positive) even though
 * recordPayoutSchema already enforces the same rule at the future Server
 * Action boundary. Mirrors recordContribution's own parseAmount exactly;
 * schema validation passing is never treated as authoritative for money.
 */
function parseAmount(value: string): Prisma.Decimal {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new InvalidPayoutAmountError("Amount must have no more than two decimal places.");
  }

  const [whole] = value.split(".");
  if (whole.length > 16) {
    throw new InvalidPayoutAmountError("Amount must fit DECIMAL(18,2).");
  }

  const amount = new Prisma.Decimal(value);
  if (!amount.gt(0)) {
    throw new InvalidPayoutAmountError("Amount must be greater than zero.");
  }

  return amount;
}

function serializeRecordedPayout(payout: PayoutRecord): RecordedPayoutResult {
  return {
    id: payout.id,
    circleId: payout.circleId,
    roundId: payout.roundId,
    amount: toMoney(payout.amount),
    currency: payout.currency,
    status: payout.status,
    clientOperationId: payout.clientOperationId,
    recordedAt: payout.recordedAt.toISOString(),
    recordedById: payout.recordedById,
  };
}

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * The round's authoritative payout amount and currency, read fresh from
 * frozen ContributionObligation history (7K.1 item 1). Throws
 * PayoutAccountingIntegrityError (from the domain layer) for an empty or
 * currency-inconsistent obligation set -- never a silent best-effort sum.
 */
async function loadExpectedPayout(
  client: Client,
  circleId: string,
  roundId: string,
): Promise<ExpectedPayoutAmount> {
  // Scoped by (circleId, roundId): every row returned structurally belongs
  // to this circle AND this round, so no per-row ownership check is needed
  // (see the repository's own doc comment).
  const obligations = await findRoundObligationsForPayout(client, circleId, roundId);
  return computeExpectedPayoutAmount(obligations);
}

/**
 * Resolves a clientOperationId match as either a legitimate replay or a
 * conflict, in two distinct layers that must not be collapsed:
 *
 *  1. INTENT (7K.1 item 6). A reused operation id is only the same
 *     operation if it targets the SAME round for the SAME amount.
 *     Anything else is an intent conflict -- never a silent replay of a
 *     different financial intent.
 *  2. PERSISTED INTEGRITY (ticket section 10). Even a matching intent is
 *     only replayable if the stored history still holds together: same
 *     circle, recording provenance present, a status this contract knows,
 *     and -- re-read authoritatively, not taken on trust -- an amount and
 *     currency that still agree with the round's own frozen obligation
 *     history. The obligation re-read is deliberate: convenience would be
 *     to skip it and return the row, but a payout whose amount no longer
 *     matches its round's frozen pot is corrupted history, and this
 *     service must surface that rather than hand it back as valid.
 *
 * Never repairs anything -- only ever reads and either returns or throws.
 * A genuine replay is returned exactly as persisted, with its ORIGINAL
 * recordedAt/recordedById and its TRUE current status.
 */
async function reconcileReplay(
  client: Client,
  circleId: string,
  existing: PayoutRecord,
  input: RecordPayoutInput,
  amount: Prisma.Decimal,
): Promise<PayoutRecord> {
  if (existing.roundId !== input.roundId || !existing.amount.equals(amount)) {
    throw new PayoutRecordingOperationConflictError();
  }

  if (
    existing.circleId !== circleId ||
    existing.recordedById.length === 0 ||
    !KNOWN_PAYOUT_STATUSES.includes(existing.status)
  ) {
    throw new PayoutRecordingIntegrityConflictError();
  }

  const expected = await loadExpectedPayout(client, circleId, existing.roundId);
  if (existing.currency !== expected.currency || !existing.amount.equals(expected.amount)) {
    throw new PayoutRecordingIntegrityConflictError();
  }

  return existing;
}

function isUniqueConstraintConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Records the owner's assertion that this round's payout was made
 * externally. Only ever INSERTS one RECORDED Payout row -- confirming,
 * disputing, closing a round, mutating obligations/contributions, and
 * touching SavingsCircle lifecycle are all explicitly out of scope.
 *
 * ownerId is trusted service context (requireUser() at the future Server
 * Action boundary, never member-session identity -- this service has no
 * member-auth dependency at all). It is still independently verified
 * twice: once unlocked, up front (fail fast, and required before the
 * idempotency check below can safely run), and again inside the locked
 * transaction for a genuinely new recording -- ownerId itself never
 * changes post-creation, but circle.status can, so the second read must be
 * fresh and lock-held.
 *
 * Eligibility, per 7K.1 sign-off item 3, is exactly: trusted owner, fresh
 * ownership, ACTIVE circle, a persisted same-circle round. Deliberately
 * NOT gated on PayoutRound.status, the round's dueDate, obligation
 * fulfillment, confirmed contributions, or any recipient state beyond the
 * round's own persisted integrity -- recordPayout records an external fact
 * that already happened, so gating it protects nothing real.
 *
 * Idempotent replay (matching clientOperationId, same round, same amount)
 * is resolved BEFORE the ACTIVE check and without taking the circle lock
 * at all: a legitimate retry must still succeed after the circle has
 * become COMPLETED or ARCHIVED and after the payout has been terminally
 * CONFIRMED or DISPUTED by a separate operation.
 */
export async function recordPayout(params: {
  ownerId: string;
  circleId: string;
  input: RecordPayoutInput;
}): Promise<RecordedPayoutResult> {
  const { ownerId, circleId, input } = params;

  const circle = await findCircleForPayoutRecording(prisma, circleId);
  if (!circle) throw new PayoutRecordingCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new PayoutRecordingAuthorizationError();

  const amount = parseAmount(input.amount);

  const existingByOperation = await findPayoutByOperationId(prisma, circleId, input.clientOperationId);
  if (existingByOperation) {
    return serializeRecordedPayout(
      await reconcileReplay(prisma, circleId, existingByOperation, input, amount),
    );
  }

  if (circle.status !== "ACTIVE") throw new PayoutRecordingCircleNotActiveError();

  try {
    const payout = await prisma.$transaction(async (transaction) => {
      const locked = await lockSavingsCircleForUpdate(transaction, circleId);
      if (!locked) throw new PayoutRecordingCircleNotFoundError();

      const freshCircle = await findCircleForPayoutRecording(transaction, circleId);
      if (!freshCircle) throw new PayoutRecordingCircleNotFoundError();
      if (freshCircle.ownerId !== ownerId) throw new PayoutRecordingAuthorizationError();

      // Re-check idempotency UNDER the lock: the pre-transaction check
      // above cannot see another request's still-in-flight insert, so two
      // truly concurrent submissions of the SAME operation both pass it.
      // The row lock serializes them -- whichever acquires it second sees
      // the first's now-committed row here and reconciles as a replay,
      // rather than falling through to the already-recorded conflict below
      // (which is for a DIFFERENT operation id racing for this round's one
      // permanent slot, not this one).
      const existingInTransaction = await findPayoutByOperationId(
        transaction,
        circleId,
        input.clientOperationId,
      );
      if (existingInTransaction) {
        return reconcileReplay(transaction, circleId, existingInTransaction, input, amount);
      }

      if (freshCircle.status !== "ACTIVE") throw new PayoutRecordingCircleNotActiveError();

      // Scoped by (id, circleId): a foreign round and a nonexistent round
      // collapse to the same safe outcome. Nothing about the round's
      // status or due date is read, let alone checked (7K.1 item 3).
      const round = await findRoundForPayoutRecording(transaction, circleId, input.roundId);
      if (!round) throw new PayoutRecordingRoundNotFoundError();

      // The authoritative amount AND currency, from frozen obligation
      // history only -- computed under the lock, never from client input,
      // never from the live cohort or circle.contributionAmount.
      const expected = await loadExpectedPayout(transaction, circleId, round.id);
      if (!amountMatchesExpectedPayout(amount, expected.amount)) {
        throw new PayoutAmountMismatchError();
      }

      // Friendly preflight for the round's single permanent slot --
      // backstopped atomically by the FULL @@unique([roundId]) index on
      // insert below. No status branch: any existing payout blocks a new
      // one, RECORDED, CONFIRMED or DISPUTED alike.
      const existingForRound = await findPayoutByRoundId(transaction, circleId, round.id);
      if (existingForRound) throw new PayoutAlreadyRecordedError();

      return createRecordedPayout(transaction, {
        circleId,
        roundId: round.id,
        amount,
        currency: expected.currency,
        clientOperationId: input.clientOperationId,
        recordedById: ownerId,
      });
    });

    return serializeRecordedPayout(payout);
  } catch (error) {
    if (!isUniqueConstraintConflict(error)) throw error;

    // A genuine race was caught at the database level. Reconcile without
    // ever inspecting the raw constraint name (error.meta.target) -- the
    // same posture contribution-recording.service.ts already takes: re-read
    // both unique indexes this insert could have collided with, in the
    // order that distinguishes the three possible outcomes.
    //
    //   A. same operation id, same intent      -> replay
    //   B. same operation id, different intent -> intent conflict
    //   C. different operation, same round     -> already-recorded conflict
    const raced = await findPayoutByOperationId(prisma, circleId, input.clientOperationId);
    if (raced) {
      return serializeRecordedPayout(await reconcileReplay(prisma, circleId, raced, input, amount));
    }

    const racedForRound = await findPayoutByRoundId(prisma, circleId, input.roundId);
    if (racedForRound) throw new PayoutAlreadyRecordedError();

    throw new PayoutRecordingConflictError();
  }
}
