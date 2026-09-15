import { Prisma, type PrismaClient } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

const retirementCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
  archivedAt: true,
  archivedById: true,
} satisfies Prisma.SavingsCircleSelect;

export type RetirementCircleRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof retirementCircleSelect;
}>;

export function findCircleForRetirement(client: Client, circleId: string) {
  return client.savingsCircle.findUnique({ where: { id: circleId }, select: retirementCircleSelect });
}

export async function countDraftCircleChildren(client: Client, circleId: string) {
  const [rounds, obligations, payments, payouts] = await Promise.all([
    client.payoutRound.count({ where: { circleId } }),
    client.contributionObligation.count({ where: { circleId } }),
    client.contributionPayment.count({ where: { circleId } }),
    client.payout.count({ where: { circleId } }),
  ]);
  return { rounds, obligations, payments, payouts };
}

/** Deletes only DRAFT setup data in restrictive-FK order; never ledger history. */
export async function deleteEligibleDraftCircle(client: Client, input: { circleId: string; ownerId: string }) {
  await client.circleMemberSession.deleteMany({ where: { circleId: input.circleId } });
  await client.circleMember.deleteMany({ where: { circleId: input.circleId } });
  return client.savingsCircle.deleteMany({ where: { id: input.circleId, ownerId: input.ownerId, status: "DRAFT" } });
}

export function cancelActiveCircle(client: Client, input: { circleId: string; ownerId: string }) {
  return client.savingsCircle.updateMany({
    where: { id: input.circleId, ownerId: input.ownerId, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });
}

export function archiveCompletedCircle(client: Client, input: { circleId: string; ownerId: string; archivedAt: Date }) {
  return client.savingsCircle.updateMany({
    where: { id: input.circleId, ownerId: input.ownerId, status: "COMPLETED" },
    data: { status: "ARCHIVED", archivedAt: input.archivedAt, archivedById: input.ownerId },
  });
}
