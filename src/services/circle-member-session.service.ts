import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/src/prisma";
import {
  createSessionRecord,
  findMemberForSessionIssuance,
  findSessionForValidation,
  revokeAllSessionsForMember,
  revokeSessionByTokenHash,
} from "@/src/repositories/circle-member-session.repository";

// This is a completely separate identity system from platform User /
// Auth.js. A SUSU member session represents (circleId, memberId,
// credentialVersion) and must never carry or be derived from a platform
// User.id, an Auth.js JWT, or session.user.id. Nothing in this file imports
// next-auth, @/auth, or next/headers.

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, fixed absolute lifetime for V1 -- no sliding/refresh.
const TOKEN_BYTES = 32;

// Circle lifecycle states that still permit issuing/validating a member
// session. DRAFT (not yet started) and CANCELLED (terminated) are excluded
// by omission -- this is an allowlist, not a denylist, so any future
// CircleStatus value defaults to "not eligible" rather than "eligible."
const ELIGIBLE_CIRCLE_STATUSES = new Set(["ACTIVE", "COMPLETED", "ARCHIVED"]);

export class CircleMemberSessionMemberNotFoundError extends Error {
  constructor() {
    super("Member not found for this circle.");
    this.name = "CircleMemberSessionMemberNotFoundError";
  }
}

export class CircleMemberSessionMemberNotActiveError extends Error {
  constructor() {
    super("This member is not active.");
    this.name = "CircleMemberSessionMemberNotActiveError";
  }
}

export class CircleMemberSessionCircleNotEligibleError extends Error {
  constructor() {
    super("This circle's current state does not permit member sessions.");
    this.name = "CircleMemberSessionCircleNotEligibleError";
  }
}

export class CircleMemberSessionCredentialVersionMismatchError extends Error {
  constructor() {
    super("Credential version is out of date.");
    this.name = "CircleMemberSessionCredentialVersionMismatchError";
  }
}

function generateRawSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export type CreatedCircleMemberSession = {
  readonly sessionId: string;
  /** Returned exactly once, for the (future) caller to set as a cookie value. Never persisted, never logged. */
  readonly rawToken: string;
  readonly circleId: string;
  readonly memberId: string;
  readonly expiresAt: string;
};

/**
 * Issues a new member session after re-verifying every precondition against
 * fresh database state -- caller-supplied membership/circle state is never
 * trusted, only `credentialVersion` is taken as input (and is itself
 * compared against the current stored value, not trusted at face value).
 *
 * This function is called from a trusted internal orchestration context
 * ONLY (per the ticket's stated future flow: source trust -> rate limit ->
 * verify member code + PIN -> createCircleMemberSession), after credentials
 * have already been verified elsewhere -- it is not itself a public
 * authentication boundary, so its errors are specific/internal rather than
 * generic. `validateCircleMemberSession` below, which IS exposed to every
 * subsequent request a browser makes, is the one that must never leak which
 * precondition failed.
 *
 * No explicit row lock is taken between the read and the insert: a
 * concurrent credentialVersion change (e.g. a future PIN rotation) landing
 * in that narrow window would, at worst, issue a session that fails its own
 * very next validation (validation re-checks credentialVersion against
 * fresh state on every call) -- self-healing, not a security bypass. Adding
 * locking here for a single read-then-insert with no compensating write
 * would be complexity without a corresponding safety gain.
 */
export async function createCircleMemberSession(input: {
  circleId: string;
  memberId: string;
  credentialVersion: number;
}): Promise<CreatedCircleMemberSession> {
  const member = await findMemberForSessionIssuance(prisma, input.circleId, input.memberId);
  if (!member) throw new CircleMemberSessionMemberNotFoundError();
  if (member.status !== "ACTIVE") throw new CircleMemberSessionMemberNotActiveError();
  if (!ELIGIBLE_CIRCLE_STATUSES.has(member.circle.status)) {
    throw new CircleMemberSessionCircleNotEligibleError();
  }
  if (member.credentialVersion !== input.credentialVersion) {
    throw new CircleMemberSessionCredentialVersionMismatchError();
  }

  const rawToken = generateRawSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  const session = await createSessionRecord(prisma, {
    circleId: input.circleId,
    memberId: input.memberId,
    tokenHash,
    credentialVersion: input.credentialVersion,
    expiresAt,
  });

  return {
    sessionId: session.id,
    rawToken,
    circleId: session.circleId,
    memberId: session.memberId,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export type CircleMemberSessionIdentity = {
  readonly circleId: string;
  readonly memberId: string;
};

export type ValidateCircleMemberSessionResult =
  | { readonly valid: true; readonly identity: CircleMemberSessionIdentity }
  | { readonly valid: false };

/**
 * Validates a presented raw session token against fresh database truth.
 * Returns only `{ valid: false }` for every failure -- unknown token,
 * revoked, expired, removed member, credentialVersion mismatch, and
 * ineligible circle state are all indistinguishable to the caller. This is
 * deliberate: a valid session proves only "this browser once authenticated
 * as member X," never "member X is still authorized" -- every call re-reads
 * current membership and circle state rather than trusting anything stored
 * on the session row beyond its own identity and credentialVersion snapshot.
 *
 * lastUsedAt is intentionally left unchanged here (see
 * docs/security/circle-member-session-contract.md, "lastUsedAt") --
 * validation is a pure read, no write, on every call in V1.
 *
 * Never throws; an unexpected internal failure (e.g. a database error) is
 * caught and reported the same as any other invalid session.
 */
export async function validateCircleMemberSession(
  rawToken: string,
): Promise<ValidateCircleMemberSessionResult> {
  if (!rawToken || rawToken.trim().length === 0) return { valid: false };

  try {
    const tokenHash = hashSessionToken(rawToken);
    const session = await findSessionForValidation(prisma, tokenHash);
    if (!session) return { valid: false };
    if (session.revokedAt) return { valid: false };
    if (session.expiresAt.getTime() <= Date.now()) return { valid: false };

    const member = session.member;
    if (!member) return { valid: false };
    if (member.circleId !== session.circleId) return { valid: false };
    if (member.status !== "ACTIVE") return { valid: false };
    if (member.credentialVersion !== session.credentialVersion) return { valid: false };
    if (!ELIGIBLE_CIRCLE_STATUSES.has(member.circle.status)) return { valid: false };

    return { valid: true, identity: { circleId: session.circleId, memberId: session.memberId } };
  } catch (error) {
    console.error(
      "[validateCircleMemberSession] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { valid: false };
  }
}

/**
 * Revokes exactly one session by its raw token (the shape a future logout
 * action will actually have on hand -- it never learns the session's
 * internal id). Idempotent: revoking an already-revoked or nonexistent
 * token both return `{ revoked: false }` without distinguishing which.
 * Marks the row revoked; never deletes it.
 */
export async function revokeCircleMemberSessionByToken(
  rawToken: string,
): Promise<{ readonly revoked: boolean }> {
  if (!rawToken || rawToken.trim().length === 0) return { revoked: false };

  const tokenHash = hashSessionToken(rawToken);
  const result = await revokeSessionByTokenHash(prisma, tokenHash);
  return { revoked: result.count === 1 };
}

/**
 * Revokes every currently-active session for one member, using trusted
 * membership identity (circleId + memberId) rather than any token -- for
 * use once credentials change or a member is removed (both handled by
 * future tickets; this function only provides the primitive). Marks rows
 * revoked; never deletes them.
 */
export async function revokeAllCircleMemberSessions(input: {
  circleId: string;
  memberId: string;
}): Promise<{ readonly revokedCount: number }> {
  const result = await revokeAllSessionsForMember(prisma, input.circleId, input.memberId);
  return { revokedCount: result.count };
}
