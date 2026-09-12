import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only, owner-scoped -- same posture as circle-active-owner
// .repository.ts, which this file deliberately does NOT widen: that
// repository's own select carries no completedAt field (it has no reason
// to, being ACTIVE-only), so this is its own small, separate select for a
// different audience (a COMPLETED circle's owner), per this codebase's own
// per-consumer-select discipline (see circle-active-owner.repository.ts's
// own comment on why it doesn't reuse circle-member-dashboard
// .repository.ts's round query either).
//
// The member list query is NOT duplicated here: findActiveCircleMembersForOwner
// (circle-active-owner.repository.ts) queries ACTIVE CircleMember rows
// scoped only by circleId -- it has no dependency on SavingsCircle.status
// at all (that eligibility check lives entirely in the service layer, on
// both sides) -- so it is imported and reused verbatim, not copied a
// second time.

const completedOwnerCircleSelect = {
  id: true,
  ownerId: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  status: true,
  completedAt: true,
} satisfies Prisma.SavingsCircleSelect;

export type CompletedOwnerCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof completedOwnerCircleSelect;
}>;

export function findCircleForCompletedOwnerRead(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: completedOwnerCircleSelect,
  });
}
