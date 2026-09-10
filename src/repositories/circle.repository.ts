import { Prisma, type ContributionFrequency } from "@prisma/client";

import { prisma } from "@/src/prisma";

export function createDraftCircleRecord(input: {
  ownerId: string;
  name: string;
  currency: string;
  contributionAmount: Prisma.Decimal;
  frequency: ContributionFrequency;
  startDate: Date;
}) {
  return prisma.savingsCircle.create({
    data: {
      ownerId: input.ownerId,
      name: input.name,
      currency: input.currency,
      contributionAmount: input.contributionAmount,
      frequency: input.frequency,
      startDate: input.startDate,
      status: "DRAFT",
      activatedAt: null,
      activatedById: null,
      completedAt: null,
      completedById: null,
      archivedAt: null,
      archivedById: null,
    },
    select: {
      id: true,
      name: true,
      currency: true,
      contributionAmount: true,
      frequency: true,
      startDate: true,
      status: true,
    },
  });
}

type CircleTransaction = Prisma.TransactionClient;

const draftCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

const draftMemberSelect = {
  id: true,
  circleId: true,
  displayName: true,
  email: true,
  memberCode: true,
  payoutOrder: true,
  status: true,
  addedAt: true,
  removedAt: true,
  removedById: true,
} satisfies Prisma.CircleMemberSelect;

export type DraftCircleMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof draftMemberSelect;
}>;

const draftPayoutMemberSelect = {
  id: true,
  circleId: true,
  displayName: true,
  memberCode: true,
  payoutOrder: true,
  status: true,
} satisfies Prisma.CircleMemberSelect;

export type DraftCirclePayoutMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof draftPayoutMemberSelect;
}>;

const activationCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  activatedAt: true,
  activatedById: true,
  completedAt: true,
  completedById: true,
  archivedAt: true,
  archivedById: true,
} satisfies Prisma.SavingsCircleSelect;

export type CircleActivationRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof activationCircleSelect;
}>;

const activationRoundSelect = {
  id: true,
  circleId: true,
  roundNumber: true,
  recipientId: true,
  dueDate: true,
  status: true,
  activatedAt: true,
  activatedById: true,
  closedAt: true,
  closedById: true,
} satisfies Prisma.PayoutRoundSelect;

export type CircleActivationRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof activationRoundSelect;
}>;

const activationObligationSelect = {
  circleId: true,
  roundId: true,
  memberId: true,
  expectedAmount: true,
  currency: true,
  dueDate: true,
  status: true,
  fulfilledAt: true,
} satisfies Prisma.ContributionObligationSelect;

export type CircleActivationObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof activationObligationSelect;
}>;

export function findCircleForDraftMembership(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.savingsCircle.findUnique({
    where: { id: circleId },
    select: draftCircleSelect,
  });
}

export function createDraftCircleMember(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    displayName: string;
    email: string | undefined;
    memberCode: string;
    pinHash: string;
    addedAt: Date;
    addedById: string;
  },
) {
  return transaction.circleMember.create({
    data: {
      circleId: input.circleId,
      userId: null,
      displayName: input.displayName,
      email: input.email ?? null,
      memberCode: input.memberCode,
      pinHash: input.pinHash,
      payoutOrder: null,
      status: "ACTIVE",
      addedAt: input.addedAt,
      addedById: input.addedById,
      removedAt: null,
      removedById: null,
    },
    select: draftMemberSelect,
  });
}

export function findDraftCircleMember(
  transaction: CircleTransaction,
  circleId: string,
  memberId: string,
) {
  return transaction.circleMember.findFirst({
    where: { id: memberId, circleId },
    select: draftMemberSelect,
  });
}

export function removeActiveDraftCircleMember(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    memberId: string;
    removedAt: Date;
    removedById: string;
  },
) {
  return transaction.circleMember.updateMany({
    where: { id: input.memberId, circleId: input.circleId, status: "ACTIVE" },
    data: {
      status: "REMOVED",
      payoutOrder: null,
      removedAt: input.removedAt,
      removedById: input.removedById,
    },
  });
}

export function findActiveDraftCircleMembers(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.circleMember.findMany({
    where: { circleId, status: "ACTIVE" },
    select: draftPayoutMemberSelect,
  });
}

export function clearActiveDraftCirclePayoutOrders(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.circleMember.updateMany({
    where: { circleId, status: "ACTIVE" },
    data: { payoutOrder: null },
  });
}

export function assignActiveDraftCirclePayoutOrder(
  transaction: CircleTransaction,
  input: { circleId: string; memberId: string; payoutOrder: number },
) {
  return transaction.circleMember.updateMany({
    where: { id: input.memberId, circleId: input.circleId, status: "ACTIVE" },
    data: { payoutOrder: input.payoutOrder },
  });
}

export function findCircleForActivation(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.savingsCircle.findUnique({
    where: { id: circleId },
    select: activationCircleSelect,
  });
}

export function findCircleActivationRounds(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.payoutRound.findMany({
    where: { circleId },
    select: activationRoundSelect,
  });
}

export function findCircleActivationObligations(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.contributionObligation.findMany({
    where: { circleId },
    select: activationObligationSelect,
  });
}

export function createCircleActivationRounds(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    rounds: Array<{ roundNumber: number; recipientId: string; dueDate: Date }>;
  },
) {
  return Promise.all(input.rounds.map((round) => transaction.payoutRound.create({
    data: {
      circleId: input.circleId,
      roundNumber: round.roundNumber,
      recipientId: round.recipientId,
      dueDate: round.dueDate,
      status: "UPCOMING",
      activatedAt: null,
      activatedById: null,
      closedAt: null,
      closedById: null,
    },
    select: activationRoundSelect,
  })));
}

export function createCircleActivationObligations(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    expectedAmount: Prisma.Decimal;
    currency: string;
    obligations: Array<{ roundId: string; memberId: string; dueDate: Date }>;
  },
) {
  return transaction.contributionObligation.createMany({
    data: input.obligations.map((obligation) => ({
      circleId: input.circleId,
      roundId: obligation.roundId,
      memberId: obligation.memberId,
      expectedAmount: input.expectedAmount,
      currency: input.currency,
      dueDate: obligation.dueDate,
      status: "OPEN",
      fulfilledAt: null,
    })),
  });
}

export function markCircleActive(
  transaction: CircleTransaction,
  input: { circleId: string; activatedAt: Date; activatedById: string },
) {
  return transaction.savingsCircle.updateMany({
    where: { id: input.circleId, status: "DRAFT" },
    data: {
      status: "ACTIVE",
      activatedAt: input.activatedAt,
      activatedById: input.activatedById,
      completedAt: null,
      completedById: null,
      archivedAt: null,
      archivedById: null,
    },
  });
}
