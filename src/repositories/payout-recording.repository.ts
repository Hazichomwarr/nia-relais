import { Prisma, type PrismaClient } from "@prisma/client";

// Every function here takes either the plain prisma client or an open
// transaction -- the same "Client = PrismaClient | Prisma.TransactionClient"
// convention contribution-recording.repository.ts already established, so
// payout-recording.service.ts can reuse one query for both its unlocked,
// fail-fast pre-checks and its authoritative, lock-held checks without
// duplicating any of them.

type Client = PrismaClient | Prisma.TransactionClient;

const payoutCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type PayoutRecordingCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof payoutCircleSelect;
}>;

export function findCircleForPayoutRecording(client: Client, circleId: string) {
  return client.savingsCircle.findUnique({
    where: { id: circleId },
    select: payoutCircleSelect,
  });
}

const payoutRoundSelect = {
  id: true,
  circleId: true,
} satisfies Prisma.PayoutRoundSelect;

export type PayoutRoundForRecordingRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof payoutRoundSelect;
}>;

/**
 * Scoped by (id, circleId) -- not id alone, exactly like
 * findObligationForRecording. A round belonging to a different circle and a
 * round that does not exist at all therefore collapse to the same result
 * (null) and, in the service, to the same domain error: nothing here ever
 * tells a caller that some other circle's round exists (7K audit section 16).
 *
 * Nothing beyond identity is selected: PayoutRound.status and dueDate are
 * deliberately not read, because 7K.1 sign-off item 3 freezes recording as
 * ungated by either, and selecting them would invite a future gate.
 */
export function findRoundForPayoutRecording(client: Client, circleId: string, roundId: string) {
  return client.payoutRound.findFirst({
    where: { id: roundId, circleId },
    select: payoutRoundSelect,
  });
}

const payoutRoundObligationSelect = {
  id: true,
  expectedAmount: true,
  currency: true,
} satisfies Prisma.ContributionObligationSelect;

export type PayoutRoundObligationForRecordingRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof payoutRoundObligationSelect;
}>;

/**
 * ALL persisted obligations for one round, the frozen historical authority
 * for that round's payout amount (7K audit section 5, 7K.1 sign-off item 1).
 * Deliberately unfiltered by ContributionObligationStatus: the expected
 * payout is the round's whole pot as frozen at activation, never "only the
 * fulfilled part," and no writer in this codebase sets that status anyway.
 *
 * The (circleId, roundId) scoping is what structurally guarantees every row
 * returned belongs to the same circle AND the same round -- the same
 * "structural guarantee, not application check" convention documented on
 * findObligationForRecording. Ordered by id purely for deterministic
 * iteration; the sum itself is order-independent.
 *
 * Covered by ContributionObligation_circleId_roundId_status_idx.
 */
export function findRoundObligationsForPayout(client: Client, circleId: string, roundId: string) {
  return client.contributionObligation.findMany({
    where: { circleId, roundId },
    select: payoutRoundObligationSelect,
    orderBy: { id: "asc" },
  });
}

const payoutSelect = {
  id: true,
  circleId: true,
  roundId: true,
  amount: true,
  currency: true,
  status: true,
  clientOperationId: true,
  recordedAt: true,
  recordedById: true,
} satisfies Prisma.PayoutSelect;

export type PayoutRecord = Prisma.PayoutGetPayload<{ select: typeof payoutSelect }>;

/**
 * The circle-scoped clientOperationId lookup (@@unique([circleId,
 * clientOperationId])) that backs idempotent replay. Deliberately not scoped
 * further by roundId or amount -- the service itself decides, by comparing
 * the returned row's own roundId/amount against the caller's current input,
 * whether this is a legitimate replay or a reused operation id carrying
 * different financial intent.
 */
export function findPayoutByOperationId(client: Client, circleId: string, clientOperationId: string) {
  return client.payout.findUnique({
    where: { circleId_clientOperationId: { circleId, clientOperationId } },
    select: payoutSelect,
  });
}

/**
 * The one-payout-per-round lookup. Payout's @@unique([roundId]) is a FULL,
 * not partial, index (7K audit section 6), so unlike contributions there is
 * no "which status occupies the slot" branch to consider here: any row at
 * all -- RECORDED, CONFIRMED or DISPUTED -- occupies the round's single
 * permanent slot. Queried circle-scoped anyway, so a caller can never learn
 * about another circle's payout by round id alone.
 */
export function findPayoutByRoundId(client: Client, circleId: string, roundId: string) {
  return client.payout.findFirst({
    where: { circleId, roundId },
    select: payoutSelect,
  });
}

export function createRecordedPayout(
  client: Client,
  input: {
    circleId: string;
    roundId: string;
    amount: Prisma.Decimal;
    currency: string;
    clientOperationId: string;
    recordedById: string;
  },
) {
  return client.payout.create({
    data: {
      circleId: input.circleId,
      roundId: input.roundId,
      amount: input.amount,
      currency: input.currency,
      status: "RECORDED",
      clientOperationId: input.clientOperationId,
      recordedById: input.recordedById,
      confirmedAt: null,
      confirmedByMemberId: null,
      disputedAt: null,
      disputedByMemberId: null,
      disputeReason: null,
    },
    select: payoutSelect,
  });
}
