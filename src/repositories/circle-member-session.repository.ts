import { Prisma, type PrismaClient } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

const issuanceMemberSelect = {
  id: true,
  circleId: true,
  status: true,
  credentialVersion: true,
  circle: { select: { status: true } },
} satisfies Prisma.CircleMemberSelect;

export type CircleMemberForSessionIssuance = Prisma.CircleMemberGetPayload<{
  select: typeof issuanceMemberSelect;
}>;

/**
 * Scoped by BOTH id and circleId, not id alone: a memberId that exists but
 * belongs to a different circle must be indistinguishable from a
 * nonexistent member (returns null either way), never leaked as "found, but
 * wrong circle."
 */
export function findMemberForSessionIssuance(client: Client, circleId: string, memberId: string) {
  return client.circleMember.findFirst({
    where: { id: memberId, circleId },
    select: issuanceMemberSelect,
  });
}

export function createSessionRecord(
  client: Client,
  input: {
    circleId: string;
    memberId: string;
    tokenHash: string;
    credentialVersion: number;
    expiresAt: Date;
  },
) {
  return client.circleMemberSession.create({
    data: {
      circleId: input.circleId,
      memberId: input.memberId,
      tokenHash: input.tokenHash,
      credentialVersion: input.credentialVersion,
      expiresAt: input.expiresAt,
    },
    select: { id: true, circleId: true, memberId: true, expiresAt: true },
  });
}

const validationSessionSelect = {
  id: true,
  circleId: true,
  memberId: true,
  credentialVersion: true,
  expiresAt: true,
  revokedAt: true,
  member: {
    select: {
      id: true,
      circleId: true,
      status: true,
      credentialVersion: true,
      circle: { select: { status: true } },
    },
  },
} satisfies Prisma.CircleMemberSessionSelect;

export type CircleMemberSessionForValidation = Prisma.CircleMemberSessionGetPayload<{
  select: typeof validationSessionSelect;
}>;

/**
 * Selects only what validation needs. Deliberately excludes pinHash,
 * memberCode, email, and userId anywhere in this select -- there is no
 * field in this query's shape that could leak them even by a future
 * accidental edit widening the returned object, because they were never
 * requested.
 */
export function findSessionForValidation(client: Client, tokenHash: string) {
  return client.circleMemberSession.findUnique({
    where: { tokenHash },
    select: validationSessionSelect,
  });
}

export function revokeSessionByTokenHash(client: Client, tokenHash: string) {
  return client.circleMemberSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function revokeAllSessionsForMember(client: Client, circleId: string, memberId: string) {
  return client.circleMemberSession.updateMany({
    where: { circleId, memberId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
