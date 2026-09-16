import { Prisma } from "@prisma/client";

import type { CircleLoginIdentifier } from "@/src/validations/circle-member-auth.schema";

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
 * Resolves a classified login identifier (10E) to the internal
 * SavingsCircle.id that the rest of credential verification operates on.
 * A `CIRCLE_CODE` identifier is looked up by the unique circleCode column;
 * a `LEGACY_CIRCLE_ID` identifier already IS the internal id (10E §8's
 * bounded backward-compatibility path) and is returned as-is without a
 * query -- it is still re-verified implicitly, because
 * lockCircleMemberForCredentialVerification below only finds a member row
 * for an id that genuinely exists.
 *
 * A plain (non-locking) read: this never mutates SavingsCircle and holds no
 * row lock on it, so it cannot contend with or deadlock against circle
 * lifecycle writers that do lock that row (e.g. circle.service.ts's
 * assertDraftOwner-guarded transactions).
 */
export async function resolveCircleIdForLogin(
  transaction: MemberSecurityTransaction,
  identifier: CircleLoginIdentifier,
): Promise<string | null> {
  if (identifier.kind === "LEGACY_CIRCLE_ID") return identifier.value;

  const circle = await transaction.savingsCircle.findUnique({
    where: { circleCode: identifier.value },
    select: { id: true },
  });
  return circle?.id ?? null;
}

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
