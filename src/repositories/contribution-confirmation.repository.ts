import { Prisma, type PrismaClient } from "@prisma/client";

// Same "Client = PrismaClient | Prisma.TransactionClient" convention as
// contribution-recording.repository.ts (7J.2) -- every function here works
// both unlocked (the fast idempotent-replay path) and inside the circle
// row lock (the authoritative fresh-confirmation path). The circle lookup
// itself is deliberately NOT duplicated here: it is generic (id/ownerId/
// status only, nothing recording-specific despite its name) and is
// imported directly from contribution-recording.repository.ts by
// contribution-confirmation.service.ts.

type Client = PrismaClient | Prisma.TransactionClient;

const contributionPaymentForConfirmationSelect = {
  id: true,
  circleId: true,
  obligationId: true,
  amount: true,
  currency: true,
  status: true,
  recordedAt: true,
  recordedById: true,
  confirmedAt: true,
  confirmedById: true,
} satisfies Prisma.ContributionPaymentSelect;

export type ContributionPaymentForConfirmationRecord = Prisma.ContributionPaymentGetPayload<{
  select: typeof contributionPaymentForConfirmationSelect;
}>;

/**
 * Scoped by (id, circleId), not id alone -- a payment belonging to a
 * different circle simply resolves to null here, exactly like a
 * nonexistent one. This is deliberate: the caller must never be able to
 * distinguish "no such payment" from "that payment belongs to someone
 * else's circle" (7J.3 section 10's "do not expose whether a foreign
 * owner's payment exists").
 */
export function findPaymentForConfirmation(client: Client, circleId: string, paymentId: string) {
  return client.contributionPayment.findFirst({
    where: { id: paymentId, circleId },
    select: contributionPaymentForConfirmationSelect,
  });
}

const contributionObligationForConfirmationSelect = {
  id: true,
  expectedAmount: true,
  currency: true,
  status: true,
  fulfilledAt: true,
} satisfies Prisma.ContributionObligationSelect;

export type ContributionObligationForConfirmationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof contributionObligationForConfirmationSelect;
}>;

/**
 * Scoped by (id, circleId). ContributionPayment's own compound FK to
 * ContributionObligation ([obligationId, circleId] -> [id, circleId])
 * already structurally guarantees a payment's obligation belongs to the
 * same circle -- this lookup can only fail to find a row for a
 * legitimately-persisted payment if that structural guarantee has
 * somehow been violated. Kept as an explicit, defensive check anyway
 * (matches activateCircle's own defensive createdObligations.count sanity
 * check), never assumed away.
 */
export function findObligationForConfirmation(client: Client, circleId: string, obligationId: string) {
  return client.contributionObligation.findFirst({
    where: { id: obligationId, circleId },
    select: contributionObligationForConfirmationSelect,
  });
}

/**
 * The compare-and-swap payment transition: RECORDED -> CONFIRMED, only.
 * An affected count of 0 means the WHERE clause's status = 'RECORDED'
 * did not hold at the instant of the write -- the caller must re-read
 * fresh state and resolve it (replay / terminal conflict / integrity
 * conflict), never assume success.
 */
export function confirmRecordedPayment(
  client: Client,
  input: { paymentId: string; circleId: string; confirmedAt: Date; confirmedById: string },
) {
  return client.contributionPayment.updateMany({
    where: { id: input.paymentId, circleId: input.circleId, status: "RECORDED" },
    data: { status: "CONFIRMED", confirmedAt: input.confirmedAt, confirmedById: input.confirmedById },
  });
}

/**
 * The compare-and-swap obligation transition: OPEN -> FULFILLED, only.
 * Called in the SAME transaction as confirmRecordedPayment, after it --
 * an affected count of 0 here means the obligation was not OPEN at the
 * instant of the write, and the caller must throw rather than silently
 * proceed: since Prisma's $transaction rolls back every write in the
 * callback when it throws, this also undoes the payment's own
 * RECORDED -> CONFIRMED transition moments earlier, so a payment is never
 * left CONFIRMED next to an obligation that failed to become FULFILLED.
 */
export function fulfillOpenObligation(
  client: Client,
  input: { obligationId: string; circleId: string; fulfilledAt: Date },
) {
  return client.contributionObligation.updateMany({
    where: { id: input.obligationId, circleId: input.circleId, status: "OPEN" },
    data: { status: "FULFILLED", fulfilledAt: input.fulfilledAt },
  });
}
