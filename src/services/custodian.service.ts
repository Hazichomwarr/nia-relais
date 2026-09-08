import { Prisma } from "@prisma/client";

import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import { prisma } from "@/src/prisma";
import {
  activateCustodianAssignment,
  createPendingCustodianAssignment,
  cancelPendingCustodianAssignment,
  declineCustodianAssignment as declineCustodianAssignmentRecord,
  endActiveCustodianAssignment,
  findActiveCustodianAssignment,
  findAssignmentForDecision,
  findAssignmentForCancellation,
  findAssignmentForEnding,
  findAssignmentGoalId,
  findAssignmentGoalReference,
  findCustodianAssignmentsForOwnerGoals,
  findCustodianAssignmentsForUser,
  findGoalForCustodianAssignment,
  findGoalStatusForCustodianDecision,
  findOpenCustodianAssignment,
  findUserForCustodianAssignment,
  type CustodianAssignmentRecord,
  type CustodianDecisionRecord,
  type CustodianCancellationAssignmentRecord,
  type CustodianEndingAssignmentRecord,
  type CustodianInboxAssignmentRecord,
  type OwnerCustodianAssignmentRecord,
} from "@/src/repositories/custodian.repository";
import { lockPersonalGoalForUpdate } from "@/src/repositories/goal-lock.repository";
import type { CreateCustodianAssignmentInput } from "@/src/validations/custodian.schema";

export class GoalNotAvailableForCustodianAssignmentError extends Error {
  constructor() {
    super("This goal is not available for a new custodian assignment.");
    this.name = "GoalNotAvailableForCustodianAssignmentError";
  }
}

export class EligibleCustodianNotFoundError extends Error {
  constructor() {
    super("No eligible NIA account was found for that email.");
    this.name = "EligibleCustodianNotFoundError";
  }
}

export class SelfCustodianAssignmentError extends Error {
  constructor() {
    super("A goal owner cannot assign themselves as custodian.");
    this.name = "SelfCustodianAssignmentError";
  }
}

export class CustodianAssignmentAlreadyOpenError extends Error {
  constructor() {
    super("This goal already has a pending or active custodian assignment.");
    this.name = "CustodianAssignmentAlreadyOpenError";
  }
}

export class CustodianAssignmentNotFoundError extends Error {
  constructor() {
    super("Custodian assignment not found.");
    this.name = "CustodianAssignmentNotFoundError";
  }
}

export class CustodianAssignmentAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to decide this custodian assignment.");
    this.name = "CustodianAssignmentAuthorizationError";
  }
}

export class CustodianAssignmentDecisionConflictError extends Error {
  constructor() {
    super("This custodian assignment can no longer be changed.");
    this.name = "CustodianAssignmentDecisionConflictError";
  }
}

export class CustodianAssignmentEndAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to end this custodian assignment.");
    this.name = "CustodianAssignmentEndAuthorizationError";
  }
}

export class CustodianAssignmentEndConflictError extends Error {
  constructor() {
    super("This custodian assignment cannot be ended in its current state.");
    this.name = "CustodianAssignmentEndConflictError";
  }
}

export class CustodianAssignmentCancellationAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to cancel this custodian assignment.");
    this.name = "CustodianAssignmentCancellationAuthorizationError";
  }
}

export class CustodianAssignmentCancellationConflictError extends Error {
  readonly state: "ACTIVE" | "DECLINED" | "ENDED";

  constructor(state: "ACTIVE" | "DECLINED" | "ENDED") {
    super("This custodian assignment cannot be cancelled in its current state.");
    this.name = "CustodianAssignmentCancellationConflictError";
    this.state = state;
  }
}

export class GoalNotAvailableForCustodianAcceptanceError extends Error {
  constructor() {
    super("This goal is no longer available for custodian acceptance.");
    this.name = "GoalNotAvailableForCustodianAcceptanceError";
  }
}

export class ActiveCustodianConflictError extends Error {
  constructor() {
    super("This goal already has an active custodian.");
    this.name = "ActiveCustodianConflictError";
  }
}

export type CustodianAssignmentResult = {
  assignmentId: string;
  status: "PENDING";
  custodian: {
    displayName: string;
    email: string;
  };
};

export type CustodianDecisionResult = {
  assignmentId: string;
  goalId: string;
  status: "ACTIVE" | "DECLINED";
  custodian: {
    displayName: string;
    email: string | null;
  };
  acceptedAt: string | null;
  declinedAt: string | null;
};

export type OwnerCustodianCurrentAssignment = Omit<OwnerCustodianAssignmentRecord, "status"> & {
  status: "PENDING" | "ACTIVE";
};

export type OwnerCustodianHistoricalAssignment = {
  assignmentId: string;
  status: "DECLINED" | "CANCELLED" | "ENDED";
  displayName: string;
  email: string | null;
  assignedAt: string;
  declinedAt: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
};

export type OwnerCustodianAssignmentState = {
  current: OwnerCustodianCurrentAssignment | null;
  historical: OwnerCustodianHistoricalAssignment | null;
};

export type CustodianInboxItem = {
  id: string;
  status: "PENDING" | "ACTIVE" | "DECLINED" | "ENDED" | "CANCELLED";
  assignedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
  ownerName: string;
  goal: {
    id: string;
    name: string;
    targetAmount: string;
    weeklyAmount: string;
    currency: string;
    unlockDate: string;
  };
};

function serializeAssignment(assignment: CustodianAssignmentRecord): CustodianAssignmentResult {
  return {
    assignmentId: assignment.id,
    status: "PENDING",
    custodian: {
      displayName: assignment.displayName,
      email: assignment.email ?? "",
    },
  };
}

function serializeDecision(assignment: CustodianDecisionRecord): CustodianDecisionResult {
  return {
    assignmentId: assignment.id,
    goalId: assignment.goalId,
    status: assignment.status === "ACTIVE" ? "ACTIVE" : "DECLINED",
    custodian: {
      displayName: assignment.displayName,
      email: assignment.email,
    },
    acceptedAt: assignment.acceptedAt?.toISOString() ?? null,
    declinedAt: assignment.declinedAt?.toISOString() ?? null,
  };
}

export async function getCustodianAssignmentStatesForOwner(
  ownerId: string,
  goalIds: string[],
) {
  const assignments = await findCustodianAssignmentsForOwnerGoals(ownerId, goalIds);
  const assignmentsByGoal = new Map<string, OwnerCustodianAssignmentRecord[]>();

  for (const assignment of assignments) {
    const goalAssignments = assignmentsByGoal.get(assignment.goalId) ?? [];
    goalAssignments.push(assignment);
    assignmentsByGoal.set(assignment.goalId, goalAssignments);
  }

  return new Map(
    goalIds.map((goalId) => {
      const goalAssignments = assignmentsByGoal.get(goalId) ?? [];
      const currentCandidate =
        goalAssignments.find((assignment) => assignment.status === "PENDING") ??
        goalAssignments.find((assignment) => assignment.status === "ACTIVE") ??
        null;
      const current = currentCandidate &&
        (currentCandidate.status === "PENDING" || currentCandidate.status === "ACTIVE")
        ? { ...currentCandidate, status: currentCandidate.status as "PENDING" | "ACTIVE" }
        : null;
      const latestHistorical = goalAssignments.find((assignment) =>
        assignment.status === "DECLINED" || assignment.status === "CANCELLED" || assignment.status === "ENDED",
      ) ?? null;
      const historical = latestHistorical
        ? {
            assignmentId: latestHistorical.id,
            status: latestHistorical.status as OwnerCustodianHistoricalAssignment["status"],
            displayName: latestHistorical.displayName,
            email: latestHistorical.email,
            assignedAt: latestHistorical.assignedAt.toISOString(),
            declinedAt: latestHistorical.declinedAt?.toISOString() ?? null,
            cancelledAt: latestHistorical.cancelledAt?.toISOString() ?? null,
            endedAt: latestHistorical.endedAt?.toISOString() ?? null,
          } satisfies OwnerCustodianHistoricalAssignment
        : null;

      return [goalId, {
        current,
        historical: current ? null : historical,
      } satisfies OwnerCustodianAssignmentState] as const;
    }),
  );
}

function inboxStatusRank(status: CustodianInboxItem["status"]) {
  return status === "PENDING" ? 0 : status === "ACTIVE" ? 1 : status === "DECLINED" ? 2 : 3;
}

function relevantAssignmentDate(assignment: CustodianInboxAssignmentRecord) {
  return assignment.status === "DECLINED"
    ? assignment.declinedAt ?? assignment.assignedAt
    : assignment.status === "CANCELLED"
      ? assignment.cancelledAt ?? assignment.assignedAt
      : assignment.status === "ENDED"
      ? assignment.endedAt ?? assignment.assignedAt
      : assignment.status === "ACTIVE"
        ? assignment.acceptedAt ?? assignment.assignedAt
        : assignment.assignedAt;
}

function serializeInboxAssignment(assignment: CustodianInboxAssignmentRecord): CustodianInboxItem {
  return {
    id: assignment.id,
    status: assignment.status,
    assignedAt: assignment.assignedAt.toISOString(),
    acceptedAt: assignment.acceptedAt?.toISOString() ?? null,
    declinedAt: assignment.declinedAt?.toISOString() ?? null,
    cancelledAt: assignment.cancelledAt?.toISOString() ?? null,
    endedAt: assignment.endedAt?.toISOString() ?? null,
    ownerName: assignment.goal.owner.name,
    goal: {
      id: assignment.goal.id,
      name: assignment.goal.name,
      targetAmount: assignment.goal.targetAmount.toFixed(2),
      weeklyAmount: assignment.goal.weeklyAmount.toFixed(2),
      currency: assignment.goal.currency,
      unlockDate: assignment.goal.unlockDate.toISOString().slice(0, 10),
    },
  };
}

export async function getCustodianInboxForUser(userId: string) {
  if (!userId) return [];

  return (await findCustodianAssignmentsForUser(userId))
    .sort((left, right) => {
      const statusDifference = inboxStatusRank(left.status) - inboxStatusRank(right.status);
      if (statusDifference !== 0) return statusDifference;
      return relevantAssignmentDate(right).getTime() - relevantAssignmentDate(left).getTime() || right.id.localeCompare(left.id);
    })
    .map(serializeInboxAssignment);
}

type DecisionKind = "ACCEPT" | "DECLINE";

function assertDecisionActor(assignment: CustodianDecisionRecord, authenticatedUserId: string) {
  if (!authenticatedUserId || !assignment.userId || assignment.userId !== authenticatedUserId) {
    throw new CustodianAssignmentAuthorizationError();
  }
}

function classifyExistingDecision(
  assignment: CustodianDecisionRecord,
  decision: DecisionKind,
): CustodianDecisionResult {
  if (decision === "ACCEPT" && assignment.status === "ACTIVE") {
    return serializeDecision(assignment);
  }

  if (decision === "DECLINE" && assignment.status === "DECLINED") {
    return serializeDecision(assignment);
  }

  throw new CustodianAssignmentDecisionConflictError();
}

async function decideCustodianAssignment(
  assignmentId: string,
  authenticatedUserId: string,
  decision: DecisionKind,
) {
  if (!assignmentId) throw new CustodianAssignmentNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const assignmentReference = await findAssignmentGoalId(transaction, assignmentId);
    if (!assignmentReference) throw new CustodianAssignmentNotFoundError();

    const lockedGoal = await lockPersonalGoalForUpdate(transaction, assignmentReference.goalId);
    if (!lockedGoal) throw new CustodianAssignmentNotFoundError();

    const assignment = await findAssignmentForDecision(transaction, assignmentId);
    if (!assignment) throw new CustodianAssignmentNotFoundError();

    assertDecisionActor(assignment, authenticatedUserId);

    if (assignment.status !== "PENDING") {
      return classifyExistingDecision(assignment, decision);
    }

    const goal = await findGoalStatusForCustodianDecision(transaction, assignment.goalId);
    if (!goal) throw new CustodianAssignmentNotFoundError();

    if (decision === "ACCEPT") {
      if (goal.status !== "ACTIVE") throw new GoalNotAvailableForCustodianAcceptanceError();

      const activeAssignment = await findActiveCustodianAssignment(
        transaction,
        assignment.goalId,
        assignment.id,
      );
      if (activeAssignment) throw new ActiveCustodianConflictError();
    }

    const now = new Date();
    let updated: { count: number };

    try {
      updated = decision === "ACCEPT"
        ? await activateCustodianAssignment(transaction, assignment.id, now)
        : await declineCustodianAssignmentRecord(transaction, assignment.id, now);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ActiveCustodianConflictError();
      }

      throw error;
    }

    if (updated.count !== 1) {
      const currentAssignment = await findAssignmentForDecision(transaction, assignment.id);
      if (!currentAssignment) throw new CustodianAssignmentNotFoundError();
      assertDecisionActor(currentAssignment, authenticatedUserId);
      return classifyExistingDecision(currentAssignment, decision);
    }

    const decidedAssignment = await findAssignmentForDecision(transaction, assignment.id);
    if (!decidedAssignment) throw new CustodianAssignmentNotFoundError();

    return serializeDecision(decidedAssignment);
  });
}

export function acceptCustodianAssignment(
  assignmentId: string,
  authenticatedUserId: string,
) {
  return decideCustodianAssignment(assignmentId, authenticatedUserId, "ACCEPT");
}

export function declineCustodianAssignment(
  assignmentId: string,
  authenticatedUserId: string,
) {
  return decideCustodianAssignment(assignmentId, authenticatedUserId, "DECLINE");
}

export type EndedCustodianAssignmentResult = {
  assignmentId: string;
  goalId: string;
  status: "ENDED";
  endedAt: string;
};

function serializeEndedAssignment(
  assignment: CustodianEndingAssignmentRecord,
): EndedCustodianAssignmentResult {
  return {
    assignmentId: assignment.id,
    goalId: assignment.goalId,
    status: "ENDED",
    endedAt: assignment.endedAt?.toISOString() ?? "",
  };
}

function classifyEndState(assignment: CustodianEndingAssignmentRecord) {
  if (assignment.status === "ENDED") return serializeEndedAssignment(assignment);

  throw new CustodianAssignmentEndConflictError();
}

export async function endCustodianAssignment(
  assignmentId: string,
  authenticatedOwnerId: string,
): Promise<EndedCustodianAssignmentResult> {
  if (!assignmentId || !authenticatedOwnerId) {
    throw new CustodianAssignmentNotFoundError();
  }

  const assignmentReference = await findAssignmentGoalReference(assignmentId);
  if (!assignmentReference) throw new CustodianAssignmentNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const lockedGoal = await lockPersonalGoalForUpdate(transaction, assignmentReference.goalId);
    if (!lockedGoal) throw new CustodianAssignmentNotFoundError();

    const assignment = await findAssignmentForEnding(transaction, assignmentId);
    if (!assignment) throw new CustodianAssignmentNotFoundError();
    if (assignment.goal.ownerId !== authenticatedOwnerId) {
      throw new CustodianAssignmentEndAuthorizationError();
    }

    if (assignment.status !== "ACTIVE") return classifyEndState(assignment);

    const updated = await endActiveCustodianAssignment(
      transaction,
      assignment.id,
      authenticatedOwnerId,
      new Date(),
    );

    if (updated.count !== 1) {
      const currentAssignment = await findAssignmentForEnding(transaction, assignment.id);
      if (!currentAssignment) throw new CustodianAssignmentNotFoundError();
      if (currentAssignment.goal.ownerId !== authenticatedOwnerId) {
        throw new CustodianAssignmentEndAuthorizationError();
      }

      return classifyEndState(currentAssignment);
    }

    const endedAssignment = await findAssignmentForEnding(transaction, assignment.id);
    if (!endedAssignment) throw new CustodianAssignmentNotFoundError();

    return serializeEndedAssignment(endedAssignment);
  });
}

export type CancelledCustodianAssignmentResult = {
  assignmentId: string;
  goalId: string;
  status: "CANCELLED";
  cancelledAt: string;
};

function serializeCancelledAssignment(
  assignment: CustodianCancellationAssignmentRecord,
): CancelledCustodianAssignmentResult {
  return {
    assignmentId: assignment.id,
    goalId: assignment.goalId,
    status: "CANCELLED",
    cancelledAt: assignment.cancelledAt?.toISOString() ?? "",
  };
}

function classifyCancellationState(assignment: CustodianCancellationAssignmentRecord) {
  if (assignment.status === "CANCELLED") return serializeCancelledAssignment(assignment);
  if (assignment.status === "ACTIVE" || assignment.status === "DECLINED" || assignment.status === "ENDED") {
    throw new CustodianAssignmentCancellationConflictError(assignment.status);
  }

  throw new CustodianAssignmentCancellationConflictError("ENDED");
}

export async function cancelCustodianAssignmentRequest(
  authenticatedOwnerId: string,
  assignmentId: string,
): Promise<CancelledCustodianAssignmentResult> {
  if (!authenticatedOwnerId || !assignmentId) {
    throw new CustodianAssignmentNotFoundError();
  }

  const assignmentReference = await findAssignmentGoalReference(assignmentId);
  if (!assignmentReference) throw new CustodianAssignmentNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const lockedGoal = await lockPersonalGoalForUpdate(transaction, assignmentReference.goalId);
    if (!lockedGoal) throw new CustodianAssignmentNotFoundError();

    const assignment = await findAssignmentForCancellation(transaction, assignmentId);
    if (!assignment) throw new CustodianAssignmentNotFoundError();
    if (assignment.goal.ownerId !== authenticatedOwnerId) {
      throw new CustodianAssignmentCancellationAuthorizationError();
    }

    if (assignment.status !== "PENDING") return classifyCancellationState(assignment);

    const updated = await cancelPendingCustodianAssignment(
      transaction,
      assignment.id,
      authenticatedOwnerId,
      new Date(),
    );

    if (updated.count !== 1) {
      const currentAssignment = await findAssignmentForCancellation(transaction, assignment.id);
      if (!currentAssignment) throw new CustodianAssignmentNotFoundError();
      if (currentAssignment.goal.ownerId !== authenticatedOwnerId) {
        throw new CustodianAssignmentCancellationAuthorizationError();
      }

      return classifyCancellationState(currentAssignment);
    }

    const cancelledAssignment = await findAssignmentForCancellation(transaction, assignment.id);
    if (!cancelledAssignment) throw new CustodianAssignmentNotFoundError();

    return serializeCancelledAssignment(cancelledAssignment);
  });
}

export async function createCustodianAssignment(
  owner: { id: string },
  input: CreateCustodianAssignmentInput,
): Promise<CustodianAssignmentResult> {
  if (!owner.id) throw new GoalNotFoundOrUnauthorizedError();

  return prisma.$transaction(async (transaction) => {
    const lockedGoal = await lockPersonalGoalForUpdate(transaction, input.goalId);

    if (!lockedGoal) throw new GoalNotFoundOrUnauthorizedError();

    const goal = await findGoalForCustodianAssignment(transaction, input.goalId, owner.id);
    if (!goal) throw new GoalNotFoundOrUnauthorizedError();
    if (goal.status !== "ACTIVE") throw new GoalNotAvailableForCustodianAssignmentError();

    const candidate = await findUserForCustodianAssignment(transaction, input.custodianEmail);
    if (!candidate?.email) throw new EligibleCustodianNotFoundError();
    if (candidate.id === owner.id) throw new SelfCustodianAssignmentError();

    const openAssignment = await findOpenCustodianAssignment(transaction, input.goalId);
    if (openAssignment) {
      if (openAssignment.status === "PENDING" && openAssignment.userId === candidate.id) {
        return serializeAssignment(openAssignment);
      }

      throw new CustodianAssignmentAlreadyOpenError();
    }

    const assignment = await createPendingCustodianAssignment(transaction, {
      goalId: input.goalId,
      userId: candidate.id,
      displayName: candidate.name,
      email: candidate.email,
      assignedById: owner.id,
    });

    return serializeAssignment(assignment);
  });
}
