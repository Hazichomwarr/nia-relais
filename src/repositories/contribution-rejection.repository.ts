import { Prisma, type PrismaClient } from "@prisma/client";

// Same "Client = PrismaClient | Prisma.TransactionClient" convention as
// contribution-recording.repository.ts (7J.2) and
// contribution-confirmation.repository.ts (7J.3). The circle lookup and
// the obligation lookup are deliberately NOT duplicated here: both are
// generic (nothing recording/confirmation-specific despite their names)
// and are imported directly by contribution-rejection.service.ts --
// findCircleForContributionRecording from contribution-recording
// .repository.ts, findObligationForConfirmation from
// contribution-confirmation.repository.ts.

type Client = PrismaClient | Prisma.TransactionClient;

const contributionPaymentForRejectionSelect = {
  id: true,
  circleId: true,
  obligationId: true,
  amount: true,
  currency: true,
  status: true,
  recordedAt: true,
  recordedById: true,
  rejectedAt: true,
  rejectedById: true,
  rejectionReason: true,
  // confirmedAt/confirmedById are read (never written) here so a REJECTED
  // replay can verify THIS payment carries no contradictory confirmation
  // provenance (7J.4.1) -- a real payment is always terminal in exactly
  // one direction (contribution-state.ts), so a REJECTED row with either
  // field set is corrupted data, never a legitimate state.
  confirmedAt: true,
  confirmedById: true,
} satisfies Prisma.ContributionPaymentSelect;

export type ContributionPaymentForRejectionRecord = Prisma.ContributionPaymentGetPayload<{
  select: typeof contributionPaymentForRejectionSelect;
}>;

/**
 * Scoped by (id, circleId), not id alone -- a payment belonging to a
 * different circle simply resolves to null here, exactly like a
 * nonexistent one, so a caller can never distinguish "no such payment"
 * from "that payment belongs to someone else's circle" (7J.4 section 11's
 * "do not expose foreign ownership information" -- same rule as 7J.3's
 * findPaymentForConfirmation).
 */
export function findPaymentForRejection(client: Client, circleId: string, paymentId: string) {
  return client.contributionPayment.findFirst({
    where: { id: paymentId, circleId },
    select: contributionPaymentForRejectionSelect,
  });
}

/**
 * The compare-and-swap payment transition: RECORDED -> REJECTED, only.
 * Deliberately touches nothing on ContributionObligation -- rejection
 * must never fulfill, reopen, or otherwise change the obligation (7J.4
 * section 5). An affected count of 0 means the WHERE clause's
 * status = 'RECORDED' did not hold at the instant of the write -- the
 * caller must re-read fresh state and resolve it, never assume success.
 */
export function rejectRecordedPayment(
  client: Client,
  input: { paymentId: string; circleId: string; rejectedAt: Date; rejectedById: string; rejectionReason: string },
) {
  return client.contributionPayment.updateMany({
    where: { id: input.paymentId, circleId: input.circleId, status: "RECORDED" },
    data: {
      status: "REJECTED",
      rejectedAt: input.rejectedAt,
      rejectedById: input.rejectedById,
      rejectionReason: input.rejectionReason,
    },
  });
}
