import { Prisma, type PrismaClient } from "@prisma/client";

// Recipient-side counterpart to payout-recording.repository.ts (7K.3),
// mirroring contribution-confirmation.repository.ts's own shape (7J.3):
// every function here works both unlocked (the fast fail-fast/replay
// path) and inside the circle row lock (the authoritative fresh-
// confirmation path). The generic circle lookup is NOT duplicated here --
// findCircleForPayoutRecording (id/ownerId/status) is imported directly
// from payout-recording.repository.ts by payout-confirmation.service.ts,
// exactly as contribution-confirmation.repository.ts's own doc comment
// establishes for the analogous owner-side lookup. ownerId is unused by
// this recipient-facing flow but harmless to select.

type Client = PrismaClient | Prisma.TransactionClient;

const memberForConfirmationSelect = {
  id: true,
  circleId: true,
  status: true,
} satisfies Prisma.CircleMemberSelect;

export type MemberForPayoutConfirmationRecord = Prisma.CircleMemberGetPayload<{
  select: typeof memberForConfirmationSelect;
}>;

/**
 * Scoped by (id, circleId) -- a member belonging to a different circle
 * collapses to the same null result as a nonexistent member id, exactly
 * like findPaymentForConfirmation's own doc comment: a caller can never
 * learn whether some other circle has a member with this id.
 */
export function findMemberForPayoutConfirmation(client: Client, circleId: string, memberId: string) {
  return client.circleMember.findFirst({
    where: { id: memberId, circleId },
    select: memberForConfirmationSelect,
  });
}

const payoutForConfirmationSelect = {
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

export type PayoutForConfirmationRecord = Prisma.PayoutGetPayload<{
  select: typeof payoutForConfirmationSelect;
}>;

/**
 * Scoped by (id, circleId), exactly like findPayoutByRoundId in
 * payout-recording.repository.ts -- a payout belonging to a different
 * circle and a nonexistent payout collapse to the same null result. The
 * round's recipientId is fetched in the SAME query, via Payout's own
 * compound FK to PayoutRound(id, circleId) -- which already structurally
 * guarantees the round belongs to this same circle -- rather than as a
 * second round-lookup query: it is the one additional fact the recipient-
 * authority check needs beyond what payout-recording.repository.ts's own
 * payoutSelect already carries.
 */
export function findPayoutForConfirmation(client: Client, circleId: string, payoutId: string) {
  return client.payout.findFirst({
    where: { id: payoutId, circleId },
    select: payoutForConfirmationSelect,
  });
}

/**
 * The compare-and-swap payout transition: RECORDED -> CONFIRMED, only. An
 * affected count of 0 means the WHERE clause's status = 'RECORDED' did
 * not hold at the instant of the write -- the caller must re-read fresh
 * state and resolve it (replay / terminal dispute conflict / integrity
 * conflict), never assume success. Never writes disputedAt,
 * disputedByMemberId, or disputeReason -- those columns belong exclusively
 * to a future 7K.5 dispute writer using this identical
 * "UPDATE ... WHERE status = 'RECORDED'" CAS shape, so the two writers can
 * race safely against each other without either one needing to know
 * about the other's columns.
 */
export function confirmRecordedPayout(
  client: Client,
  input: { payoutId: string; circleId: string; confirmedAt: Date; confirmedByMemberId: string },
) {
  return client.payout.updateMany({
    where: { id: input.payoutId, circleId: input.circleId, status: "RECORDED" },
    data: {
      status: "CONFIRMED",
      confirmedAt: input.confirmedAt,
      confirmedByMemberId: input.confirmedByMemberId,
    },
  });
}
