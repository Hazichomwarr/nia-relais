import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Dedicated READ repository, deliberately separate from circle.repository.ts.
// Every existing read there (findCircleForDraftMembership,
// findCircleForActivation) takes a Prisma.TransactionClient and is an
// internal helper of circle.service.ts's own mutating functions -- neither
// is meant to be called outside an existing $transaction, and neither
// independently verifies ownership. These functions use the plain prisma
// client directly: no transaction, no row lock, no mutation.

const ownerCircleSelect = {
  id: true,
  ownerId: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

export type OwnerCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof ownerCircleSelect;
}>;

export function findCircleForOwnerRead(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: ownerCircleSelect,
  });
}

const ownerCircleMemberSelect = {
  id: true,
  displayName: true,
  memberCode: true,
  email: true,
  status: true,
  payoutOrder: true,
  addedAt: true,
  removedAt: true,
} satisfies Prisma.CircleMemberSelect;

export type OwnerCircleMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof ownerCircleMemberSelect;
}>;

/**
 * Every member (ACTIVE and REMOVED) for one circle -- explicit select,
 * never pinHash/failedPinAttempts/lockedUntil/credentialVersion/userId/
 * addedById/removedById. Deliberately unordered at the query level: the
 * two member groups (ACTIVE, REMOVED) need different sort keys, which
 * isn't expressible as a single flat Prisma orderBy -- the service layer
 * sorts the (small, bounded) result in application code instead of
 * fighting that limitation or relying on enum string ordering.
 */
export function findCircleMembersForOwner(circleId: string) {
  return prisma.circleMember.findMany({
    where: { circleId },
    select: ownerCircleMemberSelect,
  });
}
