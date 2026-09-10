import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { toMoney } from "@/src/domain/contribution-accounting";
import {
  amountMatchesExpectedPayout,
  computeExpectedPayoutAmount,
  type ExpectedPayoutAmount,
} from "@/src/domain/payout-accounting";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  confirmRecordedPayout,
  findMemberForPayoutConfirmation,
  findPayoutForConfirmation,
  type PayoutForConfirmationRecord,
} from "@/src/repositories/payout-confirmation.repository";
import {
  findCircleForPayoutRecording,
  findRoundObligationsForPayout,
} from "@/src/repositories/payout-recording.repository";
import { prisma } from "@/src/prisma";
import type { ConfirmPayoutInput } from "@/src/validations/payout.schema";

// Recipient-operated SUSU payout confirmation (7K.4). Confirms the
// recipient's own already-RECORDED payout -- exactly the
// RECORDED -> CONFIRMED transition, and nothing else. Never disputes
// (7K.5), never records (7K.3, owner-only), never closes a round, never
// completes a circle, never touches PayoutRound or SavingsCircle
// lifecycle state (7K.1 sign-off items 8/10).
//
// memberId is trusted, member-session identity (requireCircleMember(
// circleId) at the future Server Action boundary) -- this service has no
// owner-auth dependency at all, and accepts no member/recipient
// identifier in its own input (ConfirmPayoutInput carries only
// payoutId -- see payout.schema.ts). Structure mirrors
// contribution-confirmation.service.ts closely: an unlocked, fail-fast
// pre-check (membership, then recipient authority, then a
// CONFIRMED/DISPUTED short-circuit that must resolve even off-lock and
// even after the circle is no longer ACTIVE) followed by a locked,
// authoritative transaction for a genuinely fresh confirmation, which
// re-checks everything once more under the lock before writing anything.
//
// Only the persisted PayoutRound.recipientId may confirm (7K.1 item 4) --
// requireCircleMember succeeding proves only "this session belongs to
// SOME active member of this circle," never "this member is THIS round's
// recipient." That one additional check is this service's own, on top of
// the trusted circleId/memberId pair it is handed.

export class PayoutConfirmationNotFoundError extends Error {
  constructor() {
    super("Payout not found.");
    this.name = "PayoutConfirmationNotFoundError";
  }
}

export class PayoutConfirmationUnauthorizedError extends Error {
  constructor() {
    super("You are not authorized to confirm this payout.");
    this.name = "PayoutConfirmationUnauthorizedError";
  }
}

export class PayoutConfirmationCircleNotActiveError extends Error {
  constructor() {
    super("A payout can only be freshly confirmed while its circle is active.");
    this.name = "PayoutConfirmationCircleNotActiveError";
  }
}

export class PayoutConfirmationDisputedError extends Error {
  constructor() {
    super("This payout has already been disputed and cannot be confirmed.");
    this.name = "PayoutConfirmationDisputedError";
  }
}

export class PayoutConfirmationAccountingIntegrityError extends Error {
  constructor() {
    super("This payout's amount no longer matches its round's expected payout.");
    this.name = "PayoutConfirmationAccountingIntegrityError";
  }
}

export class PayoutConfirmationProvenanceIntegrityError extends Error {
  constructor() {
    super("This payout's persisted provenance is inconsistent and cannot be confirmed.");
    this.name = "PayoutConfirmationProvenanceIntegrityError";
  }
}

export class PayoutConfirmationReplayIntegrityError extends Error {
  constructor() {
    super("This payout's persisted history is inconsistent and cannot be safely replayed.");
    this.name = "PayoutConfirmationReplayIntegrityError";
  }
}

// Re-exported so a caller (a future 7K.6 Server Action) can catch the
// whole payout-confirmation error surface from this one module without
// also needing to import the domain layer -- the accounting integrity
// failure raised when a round's own obligation history is empty or
// currency-inconsistent is intrinsic to the accounting rule itself
// (src/domain/payout-accounting.ts's own comment), identical for every
// consumer, and unchanged here.
export { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";

export type ConfirmedPayoutResult = {
  readonly id: string;
  readonly circleId: string;
  readonly roundId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: "CONFIRMED";
  readonly recordedAt: string;
  readonly recordedById: string;
  readonly confirmedAt: string;
  readonly confirmedByMemberId: string;
};

type Client = PrismaClient | Prisma.TransactionClient;

function serializeConfirmedPayout(payout: {
  id: string;
  circleId: string;
  roundId: string;
  amount: Prisma.Decimal;
  currency: string;
  recordedAt: Date;
  recordedById: string;
  confirmedAt: Date | null;
  confirmedByMemberId: string | null;
}): ConfirmedPayoutResult {
  // Narrows the two nullable columns for every caller of this function:
  // both the replay path (validated by resolveConfirmedReplay before this
  // is ever reached) and the fresh-CAS path (constructed with both fields
  // freshly set) already guarantee this holds. A future caller that
  // somehow didn't would be an integrity bug in this module, not a state
  // this function should paper over by returning a payout that looks
  // confirmed but is missing its own confirmation provenance.
  if (payout.confirmedAt === null || payout.confirmedByMemberId === null) {
    throw new PayoutConfirmationReplayIntegrityError();
  }

  return {
    id: payout.id,
    circleId: payout.circleId,
    roundId: payout.roundId,
    amount: toMoney(payout.amount),
    currency: payout.currency,
    status: "CONFIRMED",
    recordedAt: payout.recordedAt.toISOString(),
    recordedById: payout.recordedById,
    confirmedAt: payout.confirmedAt.toISOString(),
    confirmedByMemberId: payout.confirmedByMemberId,
  };
}

/**
 * The round's authoritative payout amount and currency, read fresh from
 * frozen ContributionObligation history (7K.1 item 1) -- identical
 * derivation to payout-recording.service.ts's own loadExpectedPayout,
 * reused via the same repository query rather than duplicated. Throws
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
 * Resolves an already-CONFIRMED payout as either a safe, zero-write
 * replay or a terminal integrity conflict (7K.4 ticket section 7). By the
 * time this is called, the caller has already established
 * memberId === round.recipientId (the recipient-authority gate applies
 * uniformly, before any status branch) -- this function additionally
 * verifies that the STORED confirmedByMemberId agrees with that same
 * recipient, that no contradictory dispute provenance exists, that
 * recording provenance remains present, and that the payout's persisted
 * amount/currency still match the round's frozen obligation history.
 * Never repairs anything -- only ever reads and either returns or
 * throws. A genuine replay returns the row's ORIGINAL confirmedAt/
 * confirmedByMemberId, never regenerated.
 */
async function resolveConfirmedReplay(
  client: Client,
  circleId: string,
  memberId: string,
  payout: PayoutForConfirmationRecord,
): Promise<ConfirmedPayoutResult> {
  const recipientId = payout.round.recipientId;

  const provenanceConsistent =
    payout.confirmedAt !== null &&
    payout.confirmedByMemberId !== null &&
    payout.confirmedByMemberId === recipientId &&
    payout.confirmedByMemberId === memberId &&
    payout.disputedAt === null &&
    payout.disputedByMemberId === null &&
    payout.disputeReason === null &&
    payout.recordedById.length > 0;

  if (!provenanceConsistent) {
    throw new PayoutConfirmationReplayIntegrityError();
  }

  const expected = await loadExpectedPayout(client, circleId, payout.roundId);
  if (payout.currency !== expected.currency || !amountMatchesExpectedPayout(payout.amount, expected.amount)) {
    throw new PayoutConfirmationReplayIntegrityError();
  }

  return serializeConfirmedPayout(payout);
}

/**
 * Confirms the recipient's own RECORDED payout. Only ever UPDATES an
 * existing RECORDED row to CONFIRMED -- never creates a Payout, never
 * touches PayoutRound or SavingsCircle, never writes disputedAt/
 * disputedByMemberId/disputeReason.
 *
 * circleId/memberId are trusted service context (requireCircleMember(
 * circleId) at the future Server Action boundary). Fresh, persisted
 * state is independently re-verified regardless: the circle exists, the
 * CircleMember belongs to this circle and is ACTIVE, the payout belongs
 * to this circle, and PayoutRound.recipientId === memberId (7K.4 ticket
 * section 3) -- never taken on trust from the caller's own identity pair
 * alone, and never derived from any recipient/member field on the input
 * (ConfirmPayoutInput carries only payoutId).
 *
 * A foreign or nonexistent payout, and a member that does not belong to
 * this circle, collapse to the identical PayoutConfirmationNotFoundError
 * (7K.4 ticket section 13: foreign resources must not be enumerable). A
 * member that DOES belong to this circle but is not this round's
 * recipient gets the more specific PayoutConfirmationUnauthorizedError --
 * that fact reveals nothing about any resource outside the caller's own
 * circle.
 *
 * An already-CONFIRMED payout resolves as a replay, and an already-
 * DISPUTED payout as a terminal conflict, BEFORE the ACTIVE-circle check
 * and without taking the circle lock at all -- both must remain resolvable
 * even after the circle has since become COMPLETED or ARCHIVED (mirrors
 * recordPayout's own idempotent-replay-before-ACTIVE-check ordering, and
 * requireCircleMember's own contract of remaining usable across
 * ACTIVE/COMPLETED/ARCHIVED). Only a FRESH RECORDED -> CONFIRMED
 * transition requires the circle to be currently ACTIVE.
 */
export async function confirmPayout(params: {
  circleId: string;
  memberId: string;
  input: ConfirmPayoutInput;
}): Promise<ConfirmedPayoutResult> {
  const { circleId, memberId, input } = params;
  const { payoutId } = input;

  const circle = await findCircleForPayoutRecording(prisma, circleId);
  if (!circle) throw new PayoutConfirmationNotFoundError();

  const member = await findMemberForPayoutConfirmation(prisma, circleId, memberId);
  if (!member || member.status !== "ACTIVE") throw new PayoutConfirmationNotFoundError();

  const payout = await findPayoutForConfirmation(prisma, circleId, payoutId);
  if (!payout) throw new PayoutConfirmationNotFoundError();
  if (payout.round.recipientId !== memberId) throw new PayoutConfirmationUnauthorizedError();

  if (payout.status === "CONFIRMED") {
    return resolveConfirmedReplay(prisma, circleId, memberId, payout);
  }
  if (payout.status === "DISPUTED") {
    throw new PayoutConfirmationDisputedError();
  }

  if (circle.status !== "ACTIVE") throw new PayoutConfirmationCircleNotActiveError();

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, circleId);
    if (!locked) throw new PayoutConfirmationNotFoundError();

    const freshCircle = await findCircleForPayoutRecording(transaction, circleId);
    if (!freshCircle) throw new PayoutConfirmationNotFoundError();

    const freshMember = await findMemberForPayoutConfirmation(transaction, circleId, memberId);
    if (!freshMember || freshMember.status !== "ACTIVE") throw new PayoutConfirmationNotFoundError();

    // Re-check everything under the lock: another concurrent confirmPayout
    // (or a future 7K.5 dispute) call for the SAME payout may have already
    // committed between our unlocked reads above and this transaction
    // acquiring the lock (same reason confirmContribution re-checks its
    // own payment under its own lock).
    const freshPayout = await findPayoutForConfirmation(transaction, circleId, payoutId);
    if (!freshPayout) throw new PayoutConfirmationNotFoundError();
    if (freshPayout.round.recipientId !== memberId) throw new PayoutConfirmationUnauthorizedError();

    if (freshPayout.status === "CONFIRMED") {
      return resolveConfirmedReplay(transaction, circleId, memberId, freshPayout);
    }
    if (freshPayout.status === "DISPUTED") {
      throw new PayoutConfirmationDisputedError();
    }

    if (freshCircle.status !== "ACTIVE") throw new PayoutConfirmationCircleNotActiveError();

    // Provenance integrity (7K.4 ticket section 8): a RECORDED row must
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
      throw new PayoutConfirmationProvenanceIntegrityError();
    }

    // Accounting integrity (7K.4 ticket section 8): the payout's own
    // persisted amount/currency must still agree with the round's frozen
    // obligation history, recomputed fresh under the lock -- never
    // trusted from the row alone.
    const expected = await loadExpectedPayout(transaction, circleId, freshPayout.roundId);
    if (
      freshPayout.currency !== expected.currency ||
      !amountMatchesExpectedPayout(freshPayout.amount, expected.amount)
    ) {
      throw new PayoutConfirmationAccountingIntegrityError();
    }

    const confirmedAt = new Date();
    const transition = await confirmRecordedPayout(transaction, {
      payoutId,
      circleId,
      confirmedAt,
      confirmedByMemberId: memberId,
    });

    if (transition.count !== 1) {
      // Never guess which race occurred: re-read fresh state and resolve
      // it properly. Under the row lock this branch should be
      // unreachable (nothing else can have changed the payout between our
      // own read above and this write), but the CAS contract is honored
      // regardless.
      const raced = await findPayoutForConfirmation(transaction, circleId, payoutId);
      if (!raced) throw new PayoutConfirmationNotFoundError();
      if (raced.round.recipientId !== memberId) throw new PayoutConfirmationUnauthorizedError();
      if (raced.status === "CONFIRMED") return resolveConfirmedReplay(transaction, circleId, memberId, raced);
      if (raced.status === "DISPUTED") throw new PayoutConfirmationDisputedError();
      throw new PayoutConfirmationReplayIntegrityError();
    }

    return serializeConfirmedPayout({
      ...freshPayout,
      confirmedAt,
      confirmedByMemberId: memberId,
    });
  });
}
