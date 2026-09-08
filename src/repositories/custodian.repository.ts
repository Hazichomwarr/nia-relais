import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

type CustodianTransaction = Prisma.TransactionClient;

const assignmentSelect = {
  id: true,
  status: true,
  userId: true,
  displayName: true,
  email: true,
} satisfies Prisma.GoalCustodianSelect;

const decisionAssignmentSelect = {
  id: true,
  goalId: true,
  userId: true,
  status: true,
  displayName: true,
  email: true,
  acceptedAt: true,
  declinedAt: true,
} satisfies Prisma.GoalCustodianSelect;

const endingAssignmentSelect = {
  id: true,
  goalId: true,
  status: true,
  endedAt: true,
  endedById: true,
  goal: { select: { ownerId: true } },
} satisfies Prisma.GoalCustodianSelect;

const cancellationAssignmentSelect = {
  id: true,
  goalId: true,
  status: true,
  cancelledAt: true,
  cancelledById: true,
  goal: { select: { ownerId: true } },
} satisfies Prisma.GoalCustodianSelect;

const ownerAssignmentSelect = {
  id: true,
  goalId: true,
  displayName: true,
  email: true,
  status: true,
  assignedAt: true,
  acceptedAt: true,
  declinedAt: true,
  cancelledAt: true,
  endedAt: true,
} satisfies Prisma.GoalCustodianSelect;

const inboxAssignmentSelect = {
  id: true,
  status: true,
  assignedAt: true,
  acceptedAt: true,
  declinedAt: true,
  cancelledAt: true,
  endedAt: true,
  goal: {
    select: {
      id: true,
      name: true,
      targetAmount: true,
      weeklyAmount: true,
      currency: true,
      unlockDate: true,
      owner: { select: { name: true } },
    },
  },
} satisfies Prisma.GoalCustodianSelect;

export type CustodianAssignmentRecord = Prisma.GoalCustodianGetPayload<{
  select: typeof assignmentSelect;
}>;

export type CustodianDecisionRecord = Prisma.GoalCustodianGetPayload<{
  select: typeof decisionAssignmentSelect;
}>;

export type CustodianEndingAssignmentRecord = Prisma.GoalCustodianGetPayload<{
  select: typeof endingAssignmentSelect;
}>;

export type CustodianCancellationAssignmentRecord = Prisma.GoalCustodianGetPayload<{
  select: typeof cancellationAssignmentSelect;
}>;

export type OwnerCustodianAssignmentRecord = Prisma.GoalCustodianGetPayload<{
  select: typeof ownerAssignmentSelect;
}>;

export type CustodianInboxAssignmentRecord = Prisma.GoalCustodianGetPayload<{
  select: typeof inboxAssignmentSelect;
}>;

export function findCustodianAssignmentsForUser(userId: string) {
  return prisma.goalCustodian.findMany({
    where: { userId },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: inboxAssignmentSelect,
  });
}

export function findCustodianAssignmentsForOwnerGoals(ownerId: string, goalIds: string[]) {
  if (goalIds.length === 0) return Promise.resolve([] as OwnerCustodianAssignmentRecord[]);

  return prisma.goalCustodian.findMany({
    where: {
      goalId: { in: goalIds },
      goal: { ownerId },
    },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: ownerAssignmentSelect,
  });
}

export function findAssignmentGoalId(
  transaction: CustodianTransaction,
  assignmentId: string,
) {
  return transaction.goalCustodian.findUnique({
    where: { id: assignmentId },
    select: { goalId: true },
  });
}

export function findAssignmentGoalReference(assignmentId: string) {
  return prisma.goalCustodian.findUnique({
    where: { id: assignmentId },
    select: { goalId: true },
  });
}

export function findAssignmentForEnding(
  transaction: CustodianTransaction,
  assignmentId: string,
) {
  return transaction.goalCustodian.findUnique({
    where: { id: assignmentId },
    select: endingAssignmentSelect,
  });
}

export function endActiveCustodianAssignment(
  transaction: CustodianTransaction,
  assignmentId: string,
  endedById: string,
  endedAt: Date,
) {
  return transaction.goalCustodian.updateMany({
    where: { id: assignmentId, status: "ACTIVE" },
    data: { status: "ENDED", endedAt, endedById },
  });
}

export function findAssignmentForCancellation(
  transaction: CustodianTransaction,
  assignmentId: string,
) {
  return transaction.goalCustodian.findUnique({
    where: { id: assignmentId },
    select: cancellationAssignmentSelect,
  });
}

export function cancelPendingCustodianAssignment(
  transaction: CustodianTransaction,
  assignmentId: string,
  cancelledById: string,
  cancelledAt: Date,
) {
  return transaction.goalCustodian.updateMany({
    where: { id: assignmentId, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt, cancelledById },
  });
}

export function findAssignmentForDecision(
  transaction: CustodianTransaction,
  assignmentId: string,
) {
  return transaction.goalCustodian.findUnique({
    where: { id: assignmentId },
    select: decisionAssignmentSelect,
  });
}

export function findGoalStatusForCustodianDecision(
  transaction: CustodianTransaction,
  goalId: string,
) {
  return transaction.personalGoal.findUnique({
    where: { id: goalId },
    select: { status: true },
  });
}

export function findActiveCustodianAssignment(
  transaction: CustodianTransaction,
  goalId: string,
  excludedAssignmentId: string,
) {
  return transaction.goalCustodian.findFirst({
    where: {
      goalId,
      status: "ACTIVE",
      id: { not: excludedAssignmentId },
    },
    select: { id: true },
  });
}

export function activateCustodianAssignment(
  transaction: CustodianTransaction,
  assignmentId: string,
  acceptedAt: Date,
) {
  return transaction.goalCustodian.updateMany({
    where: { id: assignmentId, status: "PENDING" },
    data: { status: "ACTIVE", acceptedAt },
  });
}

export function declineCustodianAssignment(
  transaction: CustodianTransaction,
  assignmentId: string,
  declinedAt: Date,
) {
  return transaction.goalCustodian.updateMany({
    where: { id: assignmentId, status: "PENDING" },
    data: { status: "DECLINED", declinedAt },
  });
}

export function findGoalForCustodianAssignment(
  transaction: CustodianTransaction,
  goalId: string,
  ownerId: string,
) {
  return transaction.personalGoal.findFirst({
    where: { id: goalId, ownerId },
    select: { id: true, status: true },
  });
}

export function findUserForCustodianAssignment(
  transaction: CustodianTransaction,
  email: string,
) {
  return transaction.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });
}

export function findOpenCustodianAssignment(
  transaction: CustodianTransaction,
  goalId: string,
) {
  return transaction.goalCustodian.findFirst({
    where: {
      goalId,
      status: { in: ["PENDING", "ACTIVE"] },
    },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: assignmentSelect,
  });
}

export function createPendingCustodianAssignment(
  transaction: CustodianTransaction,
  input: {
    goalId: string;
    userId: string;
    displayName: string;
    email: string;
    assignedById: string;
  },
) {
  return transaction.goalCustodian.create({
    data: {
      goalId: input.goalId,
      userId: input.userId,
      displayName: input.displayName,
      email: input.email,
      status: "PENDING",
      assignedById: input.assignedById,
      acceptedAt: null,
      declinedAt: null,
      endedAt: null,
      endedById: null,
    },
    select: assignmentSelect,
  });
}
