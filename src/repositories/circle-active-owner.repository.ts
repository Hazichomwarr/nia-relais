import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only, owner-scoped. No transaction, no row lock, no mutation -- same
// posture as circle-draft-owner.repository.ts. Originally minimal (7I.5:
// just enough for a valid post-activation destination); extended (7I.6)
// with circle terms, the ACTIVE member list, and the round schedule so the
// owner's active-circle summary can render real content.
//
// The round query below is a deliberate, small duplication of
// circle-member-dashboard.repository.ts's own findRoundsForCircle (7H.2),
// not a reuse of it: that function's select is scoped specifically to what
// a MEMBER may see (recipientDisplayName only -- no recipient memberCode),
// and an existing structural test in circle-member-dashboard.service.test.ts
// asserts exactly that boundary. The owner's summary needs
// recipientMemberCode too (for member disambiguation), so rather than
// widening the member-facing repository's select -- which would weaken a
// deliberate, already-tested privacy boundary for a completely different
// audience -- this repository selects it independently, scoped only to
// what an OWNER may see.

const activeOwnerCircleSelect = {
  id: true,
  ownerId: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  status: true,
  activatedAt: true,
} satisfies Prisma.SavingsCircleSelect;

export type ActiveOwnerCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof activeOwnerCircleSelect;
}>;

export function findActiveCircleForOwnerRead(circleId: string) {
  return prisma.savingsCircle.findUnique({
    where: { id: circleId },
    select: activeOwnerCircleSelect,
  });
}

const activeOwnerMemberSelect = {
  id: true,
  displayName: true,
  memberCode: true,
  payoutOrder: true,
} satisfies Prisma.CircleMemberSelect;

export type ActiveOwnerMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof activeOwnerMemberSelect;
}>;

/**
 * ACTIVE members only, ordered by payoutOrder ascending. Unlike the draft
 * workspace's member list (circle-draft-owner.repository.ts), this never
 * needs the two-group ACTIVE/REMOVED sort or a nulls-last tiebreak: once a
 * circle is ACTIVE, every ACTIVE member has a permanent, non-null
 * payoutOrder (frozen at activation, and no service can change it
 * afterward), so a plain database ORDER BY is fully deterministic here.
 */
export function findActiveCircleMembersForOwner(circleId: string) {
  return prisma.circleMember.findMany({
    where: { circleId, status: "ACTIVE" },
    orderBy: { payoutOrder: "asc" },
    select: activeOwnerMemberSelect,
  });
}

const ownerRoundScheduleSelect = {
  id: true,
  roundNumber: true,
  dueDate: true,
  status: true,
  recipientId: true,
  recipient: { select: { displayName: true, memberCode: true } },
} satisfies Prisma.PayoutRoundSelect;

export type OwnerRoundScheduleRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof ownerRoundScheduleSelect;
}>;

/**
 * Every persisted round for the circle, ordered by roundNumber -- straight
 * from the PayoutRound row's own recipientId/dueDate/status, never
 * recomputed from current member order or today's date. See the module
 * comment above for why this is its own query rather than a reuse of
 * circle-member-dashboard.repository.ts's findRoundsForCircle.
 */
export function findRoundsForOwner(circleId: string) {
  return prisma.payoutRound.findMany({
    where: { circleId },
    orderBy: { roundNumber: "asc" },
    select: ownerRoundScheduleSelect,
  });
}
