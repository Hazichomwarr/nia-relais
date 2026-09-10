import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { toMoney } from "@/src/domain/contribution-accounting";
import {
  amountMatchesExpectedPayout,
  computeExpectedPayoutAmount,
  type ExpectedPayoutAmount,
} from "@/src/domain/payout-accounting";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import { findMemberForPayoutConfirmation } from "@/src/repositories/payout-confirmation.repository";
import {
  disputeRecordedPayout,
  findPayoutForDispute,
  type PayoutForDisputeRecord,
} from "@/src/repositories/payout-dispute.repository";
import {
  findCircleForPayoutRecording,
  findRoundObligationsForPayout,
} from "@/src/repositories/payout-recording.repository";
import { prisma } from "@/src/prisma";
import type { DisputePayoutInput } from "@/src/validations/payout.schema";

// Recipient-operated SUSU payout dispute (7K.5). Disputes the recipient's
// own already-RECORDED payout -- exactly the RECORDED -> DISPUTED
// transition, and nothing else. Never confirms (7K.4, the other terminal
// direction), never records (7K.3, owner-only), never adjudicates a
// dispute, never closes a round, never completes a circle, never touches
// PayoutRound or SavingsCircle lifecycle state (7K.1 sign-off items 8/10).
//
// memberId is trusted, member-session identity (requireCircleMember(
// circleId) at the future Server Action boundary) -- this service has no
// owner-auth dependency at all, and accepts no member/recipient
// identifier in its own input (DisputePayoutInput carries only payoutId
// and disputeReason -- see payout.schema.ts). Structure mirrors
// payout-confirmation.service.ts (7K.4) and contribution-rejection
// .service.ts (7J.4) closely: an unlocked, fail-fast pre-check
// (membership, then recipient authority, then a DISPUTED/CONFIRMED
// short-circuit that must resolve even off-lock and even after the
// circle is no longer ACTIVE) followed by a locked, authoritative
// transaction for a genuinely fresh dispute, which re-checks everything
// once more under the lock before writing anything.
//
// This service and payout-confirmation.service.ts's confirmPayout share
// the SAME circle-row lock and the SAME "UPDATE ... WHERE status =
// 'RECORDED'" CAS guard on the same Payout row, so a real confirm-vs-
// dispute race on one payout is fully serialized by it -- whichever
// transaction's CAS commits first wins, and the loser's re-read under the
// lock (or its own CAS's zero-row outcome) observes the winner's already-
// committed terminal state and resolves to the correct terminal conflict.
// See payout-dispute.service.test.ts for the concurrency evidence.

export class PayoutDisputeNotFoundError extends Error {
  constructor() {
    super("Payout not found.");
    this.name = "PayoutDisputeNotFoundError";
  }
}

export class PayoutDisputeUnauthorizedError extends Error {
  constructor() {
    super("You are not authorized to dispute this payout.");
    this.name = "PayoutDisputeUnauthorizedError";
  }
}

export class PayoutDisputeCircleNotActiveError extends Error {
  constructor() {
    super("A payout can only be freshly disputed while its circle is active.");
    this.name = "PayoutDisputeCircleNotActiveError";
  }
}

export class PayoutDisputeConfirmedError extends Error {
  constructor() {
    super("This payout has already been confirmed and cannot be disputed.");
    this.name = "PayoutDisputeConfirmedError";
  }
}

export class PayoutDisputeIntentConflictError extends Error {
  constructor() {
    super("This payout was already disputed for a different reason.");
    this.name = "PayoutDisputeIntentConflictError";
  }
}

export class InvalidDisputeReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDisputeReasonError";
  }
}

export class PayoutDisputeAccountingIntegrityError extends Error {
  constructor() {
    super("This payout's amount no longer matches its round's expected payout.");
    this.name = "PayoutDisputeAccountingIntegrityError";
  }
}

export class PayoutDisputeProvenanceIntegrityError extends Error {
  constructor() {
    super("This payout's persisted provenance is inconsistent and cannot be disputed.");
    this.name = "PayoutDisputeProvenanceIntegrityError";
  }
}

export class PayoutDisputeReplayIntegrityError extends Error {
  constructor() {
    super("This payout's persisted history is inconsistent and cannot be safely replayed.");
    this.name = "PayoutDisputeReplayIntegrityError";
  }
}

// Re-exported so a caller (a future 7K.6 Server Action) can catch the
// whole payout-dispute error surface from this one module without also
// needing to import the domain layer -- unchanged from
// payout-confirmation.service.ts's own identical re-export.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type DisputedPayoutResult = {
  readonly id: string;
  readonly circleId: string;
  readonly roundId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: "DISPUTED";
  readonly recordedAt: string;
  readonly recordedById: string;
  readonly disputedAt: string;
  readonly disputedByMemberId: string;
  readonly disputeReason: string;
};

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Defensive, service-owned re-check that the reason is a real, non-empty,
 * bounded string -- mirrors contribution-rejection.service.ts's own
 * assertValidReason exactly (same 500-character bound as
 * disputePayoutSchema's own). disputePayoutSchema already enforces this
 * (trim + min 1 + max 500) at the future Server Action boundary;
 * client-side/schema validation passing is never treated as authoritative
 * here either.
 */
function assertValidReason(disputeReason: string): string {
  const trimmed = disputeReason.trim();
  if (trimmed.length === 0) throw new InvalidDisputeReasonError("Enter a dispute reason.");
  if (trimmed.length > 500) throw new InvalidDisputeReasonError("Dispute reason must be 500 characters or fewer.");
  return trimmed;
}

function serializeDisputedPayout(payout: {
  id: string;
  circleId: string;
  roundId: string;
  amount: Prisma.Decimal;
  currency: string;
  recordedAt: Date;
  recordedById: string;
  disputedAt: Date | null;
  disputedByMemberId: string | null;
  disputeReason: string | null;
}): DisputedPayoutResult {
  // Narrows the three nullable columns for every caller of this function:
  // both the replay path (validated by resolveDisputedReplay before this
  // is ever reached) and the fresh-CAS path (constructed with all three
  // fields freshly set) already guarantee this holds.
  if (payout.disputedAt === null || payout.disputedByMemberId === null || payout.disputeReason === null) {
    throw new PayoutDisputeReplayIntegrityError();
  }

  return {
    id: payout.id,
    circleId: payout.circleId,
    roundId: payout.roundId,
    amount: toMoney(payout.amount),
    currency: payout.currency,
    status: "DISPUTED",
    recordedAt: payout.recordedAt.toISOString(),
    recordedById: payout.recordedById,
    disputedAt: payout.disputedAt.toISOString(),
    disputedByMemberId: payout.disputedByMemberId,
    disputeReason: payout.disputeReason,
  };
}

/**
 * The round's authoritative payout amount and currency, read fresh from
 * frozen ContributionObligation history (7K.1 item 1) -- identical
 * derivation to payout-recording.service.ts's own loadExpectedPayout and
 * payout-confirmation.service.ts's own copy of it, reused via the same
 * repository query rather than duplicated further. Throws
 * PayoutAccountingIntegrityError (domain layer) for an empty or
 * currency-inconsistent obligation set.
 */
async function loadExpectedPayout(
  client: Client,
  circleId: string,
  roundId: string,
): Promise<ExpectedPayoutAmount> {
  const obligations = await findRoundObligationsForPayout(client, circleId, roundId);
  return computeExpectedPayoutAmount(obligations);
}

/**
 * Resolves an already-DISPUTED payout as either a safe, zero-write,
 * exact-intent replay or a conflict (7K.5 ticket section 8). By the time
 * this is called, the caller has already established
 * memberId === round.recipientId (the recipient-authority gate applies
 * uniformly, before any status branch). This function additionally
 * verifies that the STORED disputedByMemberId agrees with that same
 * recipient, that no contradictory confirmation provenance exists, that
 * recording provenance remains present, and that the payout's persisted
 * amount/currency still match the round's frozen obligation history --
 * checked BEFORE the supplied reason is compared, exactly mirroring
 * contribution-rejection.service.ts's own resolveRejectedReplay ordering
 * (persisted-consistency first, intent-match second). Never repairs
 * anything -- only ever reads and either returns or throws. A genuine
 * replay returns the row's ORIGINAL disputedAt/disputedByMemberId/
 * disputeReason, never regenerated or overwritten.
 */
async function resolveDisputedReplay(
  client: Client,
  circleId: string,
  memberId: string,
  payout: PayoutForDisputeRecord,
  suppliedReason: string,
): Promise<DisputedPayoutResult> {
  const recipientId = payout.round.recipientId;

  const provenanceConsistent =
    payout.disputedAt !== null &&
    payout.disputedByMemberId !== null &&
    payout.disputeReason !== null &&
    payout.disputedByMemberId === recipientId &&
    payout.disputedByMemberId === memberId &&
    payout.confirmedAt === null &&
    payout.confirmedByMemberId === null &&
    payout.recordedById.length > 0;

  if (!provenanceConsistent) {
    throw new PayoutDisputeReplayIntegrityError();
  }

  const expected = await loadExpectedPayout(client, circleId, payout.roundId);
  if (payout.currency !== expected.currency || !amountMatchesExpectedPayout(payout.amount, expected.amount)) {
    throw new PayoutDisputeReplayIntegrityError();
  }

  if (payout.disputeReason !== suppliedReason) {
    throw new PayoutDisputeIntentConflictError();
  }

  return serializeDisputedPayout(payout);
}

/**
 * Disputes the recipient's own RECORDED payout. Only ever UPDATES an
 * existing RECORDED row to DISPUTED -- never creates a Payout, never
 * touches PayoutRound or SavingsCircle, never writes confirmedAt/
 * confirmedByMemberId.
 *
 * circleId/memberId are trusted service context (requireCircleMember(
 * circleId) at the future Server Action boundary). Fresh, persisted
 * state is independently re-verified regardless: the circle exists, the
 * CircleMember belongs to this circle and is ACTIVE, the payout belongs
 * to this circle, and PayoutRound.recipientId === memberId (7K.5 ticket
 * section 3) -- never taken on trust from the caller's own identity pair
 * alone, and never derived from any recipient/member field on the input
 * (DisputePayoutInput carries only payoutId and disputeReason).
 *
 * A foreign or nonexistent payout, and a member that does not belong to
 * this circle, collapse to the identical PayoutDisputeNotFoundError
 * (mirrors 7K.4's own "foreign resources must not be enumerable" rule). A
 * member that DOES belong to this circle but is not this round's
 * recipient gets the more specific PayoutDisputeUnauthorizedError.
 *
 * An already-DISPUTED payout resolves as an exact-intent replay, and an
 * already-CONFIRMED payout as a terminal conflict, BEFORE the
 * ACTIVE-circle check and without taking the circle lock at all -- both
 * must remain resolvable even after the circle has since become
 * COMPLETED or ARCHIVED (mirrors confirmPayout's own idempotent-replay-
 * before-ACTIVE-check ordering). Only a FRESH RECORDED -> DISPUTED
 * transition requires the circle to be currently ACTIVE.
 */
export async function disputePayout(params: {
  circleId: string;
  memberId: string;
  input: DisputePayoutInput;
}): Promise<DisputedPayoutResult> {
  const { circleId, memberId, input } = params;
  const { payoutId } = input;
  const disputeReason = assertValidReason(input.disputeReason);

  const circle = await findCircleForPayoutRecording(prisma, circleId);
  if (!circle) throw new PayoutDisputeNotFoundError();

  const member = await findMemberForPayoutConfirmation(prisma, circleId, memberId);
  if (!member || member.status !== "ACTIVE") throw new PayoutDisputeNotFoundError();

  const payout = await findPayoutForDispute(prisma, circleId, payoutId);
  if (!payout) throw new PayoutDisputeNotFoundError();
  if (payout.round.recipientId !== memberId) throw new PayoutDisputeUnauthorizedError();

  if (payout.status === "DISPUTED") {
    return resolveDisputedReplay(prisma, circleId, memberId, payout, disputeReason);
  }
  if (payout.status === "CONFIRMED") {
    throw new PayoutDisputeConfirmedError();
  }

  if (circle.status !== "ACTIVE") throw new PayoutDisputeCircleNotActiveError();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new PayoutDisputeNotFoundError();

    const freshCircle = await findCircleForPayoutRecording(transaction, circleId);
    if (!freshCircle) throw new PayoutDisputeNotFoundError();

    const freshMember = await findMemberForPayoutConfirmation(transaction, circleId, memberId);
    if (!freshMember || freshMember.status !== "ACTIVE") throw new PayoutDisputeNotFoundError();

    // Re-check everything under the lock: another concurrent disputePayout
    // (a duplicate dispute), OR a competing confirmPayout call, may have
    // already committed a terminal transition between our unlocked reads
    // above and this transaction acquiring the lock.
    const freshPayout = await findPayoutForDispute(transaction, circleId, payoutId);
    if (!freshPayout) throw new PayoutDisputeNotFoundError();
    if (freshPayout.round.recipientId !== memberId) throw new PayoutDisputeUnauthorizedError();

    if (freshPayout.status === "DISPUTED") {
      return resolveDisputedReplay(transaction, circleId, memberId, freshPayout, disputeReason);
    }
    if (freshPayout.status === "CONFIRMED") {
      throw new PayoutDisputeConfirmedError();
    }

    if (freshCircle.status !== "ACTIVE") throw new PayoutDisputeCircleNotActiveError();

    // Provenance integrity (7K.5 ticket section 9): a RECORDED row must
    // carry complete recording provenance and must NOT already carry any
    // confirmation/dispute provenance -- a defensive backstop against a
    // row that is nominally RECORDED but has been corrupted by something
    // other than this service. Never repaired, only refused.
    if (
      freshPayout.recordedById.length === 0 ||
      freshPayout.confirmedAt !== null ||
      freshPayout.confirmedByMemberId !== null ||
      freshPayout.disputedAt !== null ||
      freshPayout.disputedByMemberId !== null ||
      freshPayout.disputeReason !== null
    ) {
      throw new PayoutDisputeProvenanceIntegrityError();
    }

    // Accounting integrity (7K.5 ticket section 9): the payout's own
    // persisted amount/currency must still agree with the round's frozen
    // obligation history, recomputed fresh under the lock -- never
    // trusted from the row alone.
    const expected = await loadExpectedPayout(transaction, circleId, freshPayout.roundId);
    if (
      freshPayout.currency !== expected.currency ||
      !amountMatchesExpectedPayout(freshPayout.amount, expected.amount)
    ) {
      throw new PayoutDisputeAccountingIntegrityError();
    }

    const disputedAt = new Date();
    const transition = await disputeRecordedPayout(transaction, {
      payoutId,
      circleId,
      disputedAt,
      disputedByMemberId: memberId,
      disputeReason,
    });

    if (transition.count !== 1) {
      // Never guess which race occurred: re-read fresh state and resolve
      // it properly. Under the row lock this branch should be
      // unreachable -- a genuine confirm-vs-dispute race is instead
      // resolved by freshPayout's own re-read above already observing the
      // other transaction's committed terminal state (the row lock
      // serializes the two transactions entirely, so the loser only ever
      // acquires the lock after the winner has committed and released
      // it) -- but the CAS contract is honored regardless.
      const raced = await findPayoutForDispute(transaction, circleId, payoutId);
      if (!raced) throw new PayoutDisputeNotFoundError();
      if (raced.round.recipientId !== memberId) throw new PayoutDisputeUnauthorizedError();
      if (raced.status === "DISPUTED") {
        return resolveDisputedReplay(transaction, circleId, memberId, raced, disputeReason);
      }
      if (raced.status === "CONFIRMED") throw new PayoutDisputeConfirmedError();
      throw new PayoutDisputeReplayIntegrityError();
    }

    return serializeDisputedPayout({
      ...freshPayout,
      disputedAt,
      disputedByMemberId: memberId,
      disputeReason,
    });
  });
}
