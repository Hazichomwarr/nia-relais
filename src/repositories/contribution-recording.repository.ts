import { Prisma, type PrismaClient } from "@prisma/client";

// Every function here takes either the plain prisma client or an open
// transaction -- same "Client = PrismaClient | Prisma.TransactionClient"
// convention already used by circle-member-session.repository.ts and
// circle-member-auth-rate-limit-cleanup.repository.ts. This lets
// contribution-recording.service.ts reuse the exact same queries for its
// unlocked, fail-fast idempotency check (plain prisma, before opening a
// transaction) and its authoritative, lock-held checks (the transaction
// client, inside prisma.$transaction) without duplicating any query.

type Client = PrismaClient | Prisma.TransactionClient;

const contributionCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type ContributionRecordingCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof contributionCircleSelect;
}>;

export function findCircleForContributionRecording(client: Client, circleId: string) {
  return client.savingsCircle.findUnique({
    where: { id: circleId },
    select: contributionCircleSelect,
  });
}

const contributionObligationSelect = {
  id: true,
  expectedAmount: true,
  currency: true,
} satisfies Prisma.ContributionObligationSelect;

export type ContributionObligationForRecordingRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof contributionObligationSelect;
}>;

/**
 * Scoped by (id, circleId) -- not id alone. This is the same
 * "structural guarantee, not application check" convention the 7J audit
 * documented: ContributionObligation's own compound FKs to PayoutRound and
 * CircleMember (both [x, circleId] -> [id, circleId]) already make it
 * impossible for a row returned here to reference a round or member from a
 * different circle, so no separate round/member relationship check is
 * needed once this lookup itself is circle-scoped.
 */
export function findObligationForRecording(client: Client, circleId: string, obligationId: string) {
  return client.contributionObligation.findFirst({
    where: { id: obligationId, circleId },
    select: contributionObligationSelect,
  });
}

const activeOrConfirmedPaymentSelect = {
  id: true,
  status: true,
} satisfies Prisma.ContributionPaymentSelect;

export type ActiveOrConfirmedPaymentRecord = Prisma.ContributionPaymentGetPayload<{
  select: typeof activeOrConfirmedPaymentSelect;
}>;

/**
 * Mirrors the partial unique index's own WHERE clause exactly
 * (status IN ('RECORDED', 'CONFIRMED')) -- a friendly, preflight version of
 * the same rule the database enforces atomically on insert. Used both to
 * reject a new recording attempt early (obligation already has an
 * unresolved-or-confirmed payment) and, after a genuine race is caught as
 * a P2002, to work out which specific conflict actually occurred.
 */
export function findActiveOrConfirmedPaymentForObligation(
  client: Client,
  circleId: string,
  obligationId: string,
) {
  return client.contributionPayment.findFirst({
    where: { circleId, obligationId, status: { in: ["RECORDED", "CONFIRMED"] } },
    select: activeOrConfirmedPaymentSelect,
  });
}

const contributionPaymentSelect = {
  id: true,
  circleId: true,
  obligationId: true,
  amount: true,
  currency: true,
  status: true,
  clientOperationId: true,
  recordedAt: true,
  recordedById: true,
} satisfies Prisma.ContributionPaymentSelect;

export type ContributionPaymentRecord = Prisma.ContributionPaymentGetPayload<{
  select: typeof contributionPaymentSelect;
}>;

/**
 * The circle-scoped clientOperationId lookup (@@unique([circleId,
 * clientOperationId])) that backs idempotent replay. Deliberately not
 * scoped further by obligationId or amount -- the service itself decides,
 * by comparing the returned row's own obligationId/amount against the
 * caller's current input, whether this is a legitimate replay or a reused
 * operation id with different financial intent (see
 * contribution-recording.service.ts's reconcileReplay).
 */
export function findContributionPaymentByOperationId(
  client: Client,
  circleId: string,
  clientOperationId: string,
) {
  return client.contributionPayment.findUnique({
    where: { circleId_clientOperationId: { circleId, clientOperationId } },
    select: contributionPaymentSelect,
  });
}

export function createRecordedContributionPayment(
  client: Client,
  input: {
    circleId: string;
    obligationId: string;
    amount: Prisma.Decimal;
    currency: string;
    clientOperationId: string;
    recordedById: string;
  },
) {
  return client.contributionPayment.create({
    data: {
      circleId: input.circleId,
      obligationId: input.obligationId,
      amount: input.amount,
      currency: input.currency,
      status: "RECORDED",
      clientOperationId: input.clientOperationId,
      recordedById: input.recordedById,
      confirmedAt: null,
      confirmedById: null,
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
    },
    select: contributionPaymentSelect,
  });
}
