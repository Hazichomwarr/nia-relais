import "server-only";

import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  archiveCompletedCircle,
  cancelActiveCircle,
  countDraftCircleChildren,
  deleteEligibleDraftCircle,
  findCircleForRetirement,
  type RetirementCircleRecord,
} from "@/src/repositories/circle-retirement.repository";
import { prisma } from "@/src/prisma";

export class CircleRetirementNotFoundOrUnauthorizedError extends Error {}
export class CircleRetirementConflictError extends Error {}
export class CircleDraftDeletionBlockedError extends Error {}

function assertOwner(circle: RetirementCircleRecord, ownerId: string) {
  if (circle.ownerId !== ownerId) throw new CircleRetirementNotFoundOrUnauthorizedError();
}

export async function deleteDraftCircle(input: { ownerId: string; circleId: string }) {
  if (!input.ownerId || !input.circleId) throw new CircleRetirementNotFoundOrUnauthorizedError();
  return prisma.$transaction(async (transaction) => {
    if (!(await lockSavingsCircleForUpdate(transaction, input.circleId))) throw new CircleRetirementNotFoundOrUnauthorizedError();
    const circle = await findCircleForRetirement(transaction, input.circleId);
    if (!circle) throw new CircleRetirementNotFoundOrUnauthorizedError();
    assertOwner(circle, input.ownerId);
    if (circle.status !== "DRAFT") throw new CircleRetirementConflictError();
    const children = await countDraftCircleChildren(transaction, circle.id);
    if (Object.values(children).some((count) => count > 0)) throw new CircleDraftDeletionBlockedError();
    const deleted = await deleteEligibleDraftCircle(transaction, input);
    if (deleted.count !== 1) throw new CircleRetirementConflictError();
    return { circleId: input.circleId, deleted: true as const };
  });
}

export async function cancelCircle(input: { ownerId: string; circleId: string }) {
  if (!input.ownerId || !input.circleId) throw new CircleRetirementNotFoundOrUnauthorizedError();
  return prisma.$transaction(async (transaction) => {
    if (!(await lockSavingsCircleForUpdate(transaction, input.circleId))) throw new CircleRetirementNotFoundOrUnauthorizedError();
    const circle = await findCircleForRetirement(transaction, input.circleId);
    if (!circle) throw new CircleRetirementNotFoundOrUnauthorizedError();
    assertOwner(circle, input.ownerId);
    if (circle.status === "CANCELLED") return { circleId: circle.id, status: "CANCELLED" as const, replayed: true };
    if (circle.status !== "ACTIVE") throw new CircleRetirementConflictError();
    if ((await cancelActiveCircle(transaction, input)).count !== 1) throw new CircleRetirementConflictError();
    return { circleId: circle.id, status: "CANCELLED" as const, replayed: false };
  });
}

export async function archiveCircle(input: { ownerId: string; circleId: string }) {
  if (!input.ownerId || !input.circleId) throw new CircleRetirementNotFoundOrUnauthorizedError();
  return prisma.$transaction(async (transaction) => {
    if (!(await lockSavingsCircleForUpdate(transaction, input.circleId))) throw new CircleRetirementNotFoundOrUnauthorizedError();
    const circle = await findCircleForRetirement(transaction, input.circleId);
    if (!circle) throw new CircleRetirementNotFoundOrUnauthorizedError();
    assertOwner(circle, input.ownerId);
    if (circle.status === "ARCHIVED") return { circleId: circle.id, status: "ARCHIVED" as const, replayed: true };
    if (circle.status !== "COMPLETED") throw new CircleRetirementConflictError();
    if ((await archiveCompletedCircle(transaction, { ...input, archivedAt: new Date() })).count !== 1) {
      throw new CircleRetirementConflictError();
    }
    return { circleId: circle.id, status: "ARCHIVED" as const, replayed: false };
  });
}
