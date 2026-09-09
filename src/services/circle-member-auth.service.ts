import "server-only";

import { compare } from "bcryptjs";

import {
  lockCircleMemberForCredentialVerification,
  recordCircleMemberPinFailure,
  resetCircleMemberPinFailures,
} from "@/src/repositories/circle-member-auth.repository";
import { prisma } from "@/src/prisma";
import {
  verifyCircleMemberCredentialsSchema,
} from "@/src/validations/circle-member-auth.schema";

const DUMMY_MEMBER_PIN_HASH =
  "$2b$12$3J8xyaAqL17eGbilpz8uduBrypPAugZBH6.D7Ys2v8CgDxKhcnW4W";

export const MEMBER_PIN_MAX_ATTEMPTS = 5;
export const MEMBER_PIN_LOCKOUT_MS = 15 * 60 * 1000;

export class CircleMemberAuthenticationError extends Error {
  constructor() {
    super("Invalid member credentials.");
    this.name = "CircleMemberAuthenticationError";
  }
}

export type VerifiedCircleMemberCredentials = {
  circleId: string;
  memberId: string;
  credentialVersion: number;
};

function authenticationFailure() {
  return new CircleMemberAuthenticationError();
}

function pinFromUntrustedInput(input: unknown) {
  if (typeof input !== "object" || input === null) return "";
  const pin = (input as Record<string, unknown>).pin;
  return typeof pin === "string" ? pin : "";
}

function isAuthenticationEligible(member: NonNullable<Awaited<ReturnType<typeof lockCircleMemberForCredentialVerification>>>) {
  return (
    member.status === "ACTIVE"
    && (member.circle.status === "ACTIVE" || member.circle.status === "COMPLETED" || member.circle.status === "ARCHIVED")
  );
}

export async function verifyCircleMemberCredentials(
  input: unknown,
): Promise<VerifiedCircleMemberCredentials> {
  const parsed = verifyCircleMemberCredentialsSchema.safeParse(input);
  if (!parsed.success) {
    await compare(pinFromUntrustedInput(input), DUMMY_MEMBER_PIN_HASH);
    throw authenticationFailure();
  }

  const verified = await prisma.$transaction(async (transaction) => {
    const member = await lockCircleMemberForCredentialVerification(transaction, parsed.data);
    const pinMatches = await compare(parsed.data.pin, member?.pinHash ?? DUMMY_MEMBER_PIN_HASH);
    const now = new Date();

    if (!member || !isAuthenticationEligible(member)) return null;

    if (member.lockedUntil && member.lockedUntil > now) return null;

    if (pinMatches) {
      await resetCircleMemberPinFailures(transaction, member.id);
      return {
        circleId: member.circleId,
        memberId: member.id,
        credentialVersion: member.credentialVersion,
      };
    }

    const attemptsInNewWindow = member.lockedUntil !== null && member.lockedUntil <= now;
    const failedPinAttempts = attemptsInNewWindow ? 1 : member.failedPinAttempts + 1;
    const lockedUntil = failedPinAttempts >= MEMBER_PIN_MAX_ATTEMPTS
      ? new Date(now.getTime() + MEMBER_PIN_LOCKOUT_MS)
      : null;

    await recordCircleMemberPinFailure(transaction, {
      memberId: member.id,
      failedPinAttempts: Math.min(failedPinAttempts, MEMBER_PIN_MAX_ATTEMPTS),
      lockedUntil,
    });
    return null;
  }, {
    maxWait: 30_000,
    timeout: 30_000,
  });

  if (!verified) throw authenticationFailure();
  return verified;
}
