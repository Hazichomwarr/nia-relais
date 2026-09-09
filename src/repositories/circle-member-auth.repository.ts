import { Prisma } from "@prisma/client";

const memberCredentialSelect = {
  id: true,
  circleId: true,
  pinHash: true,
  status: true,
  failedPinAttempts: true,
  lockedUntil: true,
  credentialVersion: true,
  circle: { select: { status: true } },
} satisfies Prisma.CircleMemberSelect;

export type LockedCircleMemberCredential = Prisma.CircleMemberGetPayload<{
  select: typeof memberCredentialSelect;
}>;

type MemberSecurityTransaction = Prisma.TransactionClient;

/**
 * Member credential operations lock only this row. They never take the
 * SavingsCircle lock, so future PIN rotation can share this lock without
 * deadlocking with circle lifecycle writers.
 */
export async function lockCircleMemberForCredentialVerification(
  transaction: MemberSecurityTransaction,
  input: { circleId: string; memberCode: string },
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
      FROM "CircleMember"
      WHERE "circleId" = ${input.circleId}
        AND "memberCode" = ${input.memberCode}
      FOR UPDATE
    `,
  );
  const memberId = rows[0]?.id;
  if (!memberId) return null;

  return transaction.circleMember.findUnique({
    where: { id: memberId },
    select: memberCredentialSelect,
  });
}

export function resetCircleMemberPinFailures(
  transaction: MemberSecurityTransaction,
  memberId: string,
) {
  return transaction.circleMember.update({
    where: { id: memberId },
    data: { failedPinAttempts: 0, lockedUntil: null },
  });
}

export function recordCircleMemberPinFailure(
  transaction: MemberSecurityTransaction,
  input: { memberId: string; failedPinAttempts: number; lockedUntil: Date | null },
) {
  return transaction.circleMember.update({
    where: { id: input.memberId },
    data: {
      failedPinAttempts: input.failedPinAttempts,
      lockedUntil: input.lockedUntil,
    },
  });
}
