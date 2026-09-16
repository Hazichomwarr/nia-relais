import { z } from "zod";

import { getTrustedMemberAuthSource } from "@/src/auth/trusted-member-auth-source";
import { checkMemberAuthenticationRateLimit } from "@/src/services/circle-member-auth-rate-limit.service";
import {
  CircleMemberAuthenticationError,
  verifyCircleMemberCredentials,
} from "@/src/services/circle-member-auth.service";
import { createCircleMemberSession } from "@/src/services/circle-member-session.service";

// Wires together four already-independently-built, already-independently-
// tested services, in the fixed order the security contract requires:
//
//   trusted request source -> rate limiter -> credential verification
//     -> session issuance -> (caller sets the cookie)
//
// This file intentionally re-implements none of their logic -- it reads
// their actual current signatures (per this ticket's own audit instruction)
// rather than reconstructing them from ticket descriptions:
//   - getTrustedMemberAuthSource(request): { ok: true, source } | { ok: false }
//   - checkMemberAuthenticationRateLimit({ source, circleCode, memberCode }): { allowed: boolean }
//   - verifyCircleMemberCredentials(input: unknown): Promise<{ circleId, memberId, credentialVersion }>
//     (throws CircleMemberAuthenticationError on any failure; does its own
//     strict Zod validation and its own timing-safe dummy-bcrypt path)
//   - createCircleMemberSession({ circleId, memberId, credentialVersion })
//
// `circleCode` (10E) is the human-facing login field name -- the client
// sends either a new "NIA-XXXX" circleCode or, for credentials issued
// before 10E, a legacy raw SavingsCircle.id; verifyCircleMemberCredentials
// classifies and resolves it, never this file.

// Deliberately looser than the credential verifier's own strict schema
// (circleCode/legacy-id + member-code + 6-digit shapes): this only bounds
// size/type so a malformed request can't waste resources, and every field
// has a `.catch` fallback so parsing never throws -- circleCode/memberCode
// still need to reach the rate limiter even when malformed, per its own
// established contract (malformed targets consume bounded, shared capacity
// rather than bypassing the limiter). Strict shape validation happens one
// step later, inside verifyCircleMemberCredentials itself.
const boundedString = (max: number) => z.string().trim().max(max).catch("");

const memberLoginBoundsSchema = z.object({
  circleCode: boundedString(200),
  memberCode: boundedString(200),
  pin: boundedString(50),
});

export type MemberLoginResult =
  | { readonly ok: true; readonly rawToken: string; readonly expiresAt: string; readonly circleId: string }
  | { readonly ok: false };

function logMemberLoginFailure(stage: string) {
  // Deliberately fieldless: member auth failures must remain diagnosable in
  // production without recording credentials, member identity, or source IP.
  console.warn("[member-login] rejected", { stage });
}

async function extractBoundedLoginFields(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const candidate = body && typeof body === "object" ? body : {};
  // Every field has a `.catch("")`, so this never throws regardless of shape.
  return memberLoginBoundsSchema.parse(candidate);
}

export type CircleMemberLoginDependencies = {
  readonly getTrustedSource: typeof getTrustedMemberAuthSource;
  readonly checkRateLimit: typeof checkMemberAuthenticationRateLimit;
  readonly verifyCredentials: typeof verifyCircleMemberCredentials;
  readonly createSession: typeof createCircleMemberSession;
};

const defaultDependencies: CircleMemberLoginDependencies = {
  getTrustedSource: getTrustedMemberAuthSource,
  checkRateLimit: checkMemberAuthenticationRateLimit,
  verifyCredentials: verifyCircleMemberCredentials,
  createSession: createCircleMemberSession,
};

/**
 * Orchestrates one SUSU member login attempt end to end. Never throws for
 * any authentication-relevant failure -- returns `{ ok: false }` uniformly
 * so the route handler has exactly one generic response to produce,
 * regardless of which precondition actually failed.
 *
 * Dependencies are injectable (defaulting to the real services) specifically
 * so orchestration/ordering can be tested with plain function substitution
 * rather than monkey-patching ESM module bindings -- the production call
 * site (the route handler) never passes a second argument and always gets
 * the real services.
 */
export async function loginCircleMember(
  request: Request,
  dependencies: Partial<CircleMemberLoginDependencies> = {},
): Promise<MemberLoginResult> {
  const deps = { ...defaultDependencies, ...dependencies };

  // 1. Trusted request source. If this fails, nothing else runs -- not the
  // limiter, not the verifier. There is no fallback source.
  const sourceResult = deps.getTrustedSource(request);
  if (!sourceResult.ok) {
    logMemberLoginFailure("TRUSTED_SOURCE_UNAVAILABLE");
    return { ok: false };
  }

  const fields = await extractBoundedLoginFields(request);

  // 2. Rate limiter, using the bounded (possibly malformed) circleCode/memberCode.
  // Malformed input still consumes SOURCE/TARGET/GLOBAL capacity by design --
  // see circle-member-auth-rate-limit.service.ts.
  const rateLimitDecision = await deps.checkRateLimit({
    source: sourceResult.source,
    circleCode: fields.circleCode,
    memberCode: fields.memberCode,
  });
  if (!rateLimitDecision.allowed) {
    logMemberLoginFailure("RATE_LIMIT_DENIED");
    return { ok: false };
  }

  // 3. Credential verification. The verifier does its own strict shape
  // validation and its own timing-safe dummy-compare path internally; any
  // failure (malformed, unknown member, wrong PIN, locked, removed,
  // ineligible circle) surfaces uniformly as CircleMemberAuthenticationError.
  let verified: Awaited<ReturnType<typeof verifyCircleMemberCredentials>>;
  try {
    verified = await deps.verifyCredentials(fields);
  } catch (error) {
    if (error instanceof CircleMemberAuthenticationError) {
      logMemberLoginFailure("CREDENTIAL_REJECTED");
      return { ok: false };
    }
    throw error;
  }

  // 4. Session issuance, using ONLY the verifier's own trusted output --
  // never the raw client-supplied circleCode/memberCode/pin again, and never
  // any client-supplied memberId or credentialVersion (the request schema
  // above doesn't even have fields for those; nothing to ignore).
  try {
    const session = await deps.createSession({
      circleId: verified.circleId,
      memberId: verified.memberId,
      credentialVersion: verified.credentialVersion,
    });
    // circleId here is the verifier's own trusted, resolved internal id --
    // never the raw circleCode/legacy-id the client typed -- returned so the
    // browser can route to /member/circles/[circleId] (10E §13: internal
    // routing stays circleId-based; only the login credential changed).
    return { ok: true, rawToken: session.rawToken, expiresAt: session.expiresAt, circleId: session.circleId };
  } catch {
    // No retry. No cookie. A fresh login attempt (a new HTTP request) is the
    // only way to try again -- this function does not loop.
    logMemberLoginFailure("SESSION_CREATION_FAILED");
    return { ok: false };
  }
}
