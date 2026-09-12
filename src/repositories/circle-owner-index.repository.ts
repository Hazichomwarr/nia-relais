import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only owner-scoped discovery query. It deliberately selects only the
// compact information needed for the /circles index; detailed accounting and
// lifecycle eligibility remain in their existing dedicated read models.
const ownerCircleIndexSelect = {
  id: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  status: true,
  members: { where: { status: "ACTIVE" }, select: { id: true } },
  rounds: {
    orderBy: { roundNumber: "asc" },
    select: {
      roundNumber: true,
      dueDate: true,
      status: true,
      recipient: { select: { displayName: true } },
    },
  },
} satisfies Prisma.SavingsCircleSelect;

export type OwnerCircleIndexRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof ownerCircleIndexSelect;
}>;

export function findCirclesForOwnerIndex(ownerId: string) {
  return prisma.savingsCircle.findMany({
    where: { ownerId, status: { in: ["DRAFT", "ACTIVE", "COMPLETED"] } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: ownerCircleIndexSelect,
  });
}
