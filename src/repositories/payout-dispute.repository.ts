import { Prisma, type PrismaClient } from "@prisma/client";

// Recipient-side counterpart to payout-confirmation.repository.ts (7K.4),
// mirroring contribution-rejection.repository.ts's own shape (7J.4). The
// circle lookup and member lookup are deliberately NOT duplicated here:
// both are generic (nothing confirmation/dispute-specific despite their
// names) and are imported directly by payout-dispute.service.ts --
// findCircleForPayoutRecording from payout-recording.repository.ts,
// findMemberForPayoutConfirmation from payout-confirmation.repository.ts.

type Client = PrismaClient | Prisma.TransactionClient;

const payoutForDisputeSelect = {
  id: true,
  circleId: true,
  roundId: true,
  amount: true,
  currency: true,
  status: true,
  clientOperationId: true,
  recordedAt: true,
  recordedById: true,
  confirmedAt: true,
  confirmedByMemberId: true,
  disputedAt: true,
  disputedByMemberId: true,
  disputeReason: true,
  round: {
    select: {
      recipientId: true,
    },
  },
} satisfies Prisma.PayoutSelect;

export type PayoutForDisputeRecord = Prisma.PayoutGetPayload<{
  select: typeof payoutForDisputeSelect;
}>;

/**
 * Scoped by (id, circleId), exactly like findPayoutForConfirmation -- a
 * payout belonging to a different circle and a nonexistent payout
 * collapse to the same null result, so a caller can never distinguish
 * "no such payout" from "that payout belongs to someone else's circle."
 * confirmedAt/confirmedByMemberId are read (never written) here so a
 * DISPUTED replay can verify THIS payout carries no contradictory
 * confirmation provenance -- a real payout is always terminal in exactly
 * one direction (payout-state.ts), so a DISPUTED row with either field
 * set is corrupted data, never a legitimate state.
 */
export function findPayoutForDispute(client: Client, circleId: string, payoutId: string) {
  return client.payout.findFirst({
    where: { id: payoutId, circleId },
    select: payoutForDisputeSelect,
  });
}

/**
 * The compare-and-swap payout transition: RECORDED -> DISPUTED, only. An
 * affected count of 0 means the WHERE clause's status = 'RECORDED' did
 * not hold at the instant of the write -- the caller must re-read fresh
 * state and resolve it (exact-intent replay / different-reason intent
 * conflict / terminal CONFIRMED conflict / integrity conflict), never
 * assume success. Never writes confirmedAt or confirmedByMemberId --
 * those columns belong exclusively to payout-confirmation.repository.ts's
 * own confirmRecordedPayout, using this identical
 * "UPDATE ... WHERE status = 'RECORDED'" CAS shape, so the two writers
 * race safely against each other (see the real confirm-vs-dispute
 * concurrency test) without either one needing to know about the other's
 * columns.
 */
export function disputeRecordedPayout(
  client: Client,
  input: {
    payoutId: string;
    circleId: string;
    disputedAt: Date;
    disputedByMemberId: string;
    disputeReason: string;
  },
) {
  return client.payout.updateMany({
    where: { id: input.payoutId, circleId: input.circleId, status: "RECORDED" },
    data: {
      status: "DISPUTED",
      disputedAt: input.disputedAt,
      disputedByMemberId: input.disputedByMemberId,
      disputeReason: input.disputeReason,
    },
  });
}
