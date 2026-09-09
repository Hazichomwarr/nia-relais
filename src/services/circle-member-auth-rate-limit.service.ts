import { createHmac } from "node:crypto";

import { prisma } from "@/src/prisma";
import {
  incrementRateLimitBucket,
  type RateLimitScope,
} from "@/src/repositories/circle-member-auth-rate-limit.repository";
import { CUID_PATTERN, MEMBER_CODE_PATTERN } from "@/src/validations/circle-member-auth.schema";
import type { TrustedMemberAuthSource } from "@/src/auth/trusted-member-auth-source";

// Configuration contract for MEMBER_AUTH_RATE_LIMIT_SECRET:
// - required, distinct from AUTH_SECRET (a compromise of one must not
//   compromise the other)
// - at least 32 characters (e.g. `openssl rand -base64 32`); this is a
//   minimum-length floor, not a guarantee of true entropy, but it rules out
//   short/guessable values while adding no new dependency to measure
//   entropy properly
// If unset or too short, every call fails closed (see below) rather than
// throwing or silently using a weak/absent secret.
const RATE_LIMIT_SECRET_ENV_VAR = "MEMBER_AUTH_RATE_LIMIT_SECRET";
const MIN_SECRET_LENGTH = 32;

const MALFORMED_TARGET_MATERIAL = "malformed-target";
const GLOBAL_KEY_MATERIAL = "circle-member-auth";

// Approved policy (7G.2.5). Changing any of these values changes the
// security posture of public CircleMember authentication -- treat as a
// deliberate decision, not a tuning knob.
const POLICY: Record<RateLimitScope, { windowSeconds: number; limit: number }> = {
  SOURCE: { windowSeconds: 15 * 60, limit: 20 },
  TARGET: { windowSeconds: 15 * 60, limit: 10 },
  GLOBAL: { windowSeconds: 60, limit: 1000 },
};

export type MemberAuthRateLimitDecision = {
  readonly allowed: boolean;
};

function getRateLimitSecret(): string | null {
  const secret = process.env[RATE_LIMIT_SECRET_ENV_VAR];
  if (!secret) return null;

  const trimmed = secret.trim();
  return trimmed.length >= MIN_SECRET_LENGTH ? trimmed : null;
}

function hmacHex(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

/**
 * Reuses the same circleId/memberCode shape contract the credential
 * verifier uses (`src/validations/circle-member-auth.schema.ts`) rather
 * than redefining it. A pair that doesn't match either pattern normalizes
 * to a single, fixed, bounded sentinel material -- every malformed target
 * shares ONE TARGET bucket, so an attacker cannot create unbounded distinct
 * buckets (or unbounded CPU/memory cost) by varying garbage input, and a
 * malformed target still consumes TARGET-scope capacity instead of
 * bypassing it. The sentinel string cannot collide with a real target: it
 * is not shaped like `<circleId>:<memberCode>` and is hashed the same way,
 * so it is cryptographically distinct from every real target's key, not a
 * stand-in for any specific valid identity.
 */
function normalizeTargetMaterial(circleId: string, memberCode: string): string {
  const normalizedMemberCode = memberCode.trim().toUpperCase();

  if (CUID_PATTERN.test(circleId) && MEMBER_CODE_PATTERN.test(normalizedMemberCode)) {
    return `${circleId}:${normalizedMemberCode}`;
  }

  return MALFORMED_TARGET_MATERIAL;
}

/**
 * Checks all three rate-limit scopes (SOURCE, TARGET, GLOBAL) as a single
 * admission decision for one CircleMember authentication attempt, and
 * durably records the attempt regardless of the outcome.
 *
 * Every call increments all three scopes' counters -- including calls that
 * end up denied -- so that an exhausted scope cannot mask further attempts
 * from a different scope's view, and so a later window rollover cannot
 * hand an attacker "free" unrecorded attempts.
 *
 * CORRECTION (7G.2.6): an earlier version of this comment claimed a denied
 * attempt "increments an existing bucket, it never creates a new key." That
 * is only true for SOURCE and GLOBAL, whose single row for the current
 * window is already established the moment any attempt occurs. It is NOT
 * true for TARGET: because all three scopes are always incremented
 * regardless of whether SOURCE or GLOBAL already denied the request, an
 * attacker already blocked by SOURCE can still create a brand-new TARGET
 * row on every subsequent (denied) request simply by varying the
 * circleId/memberCode pair -- being denied does not stop the TARGET
 * increment. Malformed targets are the one bounded exception (they all
 * collapse to one shared sentinel row); syntactically-valid-but-nonexistent
 * target pairs are not deduplicated beyond the pair itself. See
 * docs/security/member-auth-rate-limit-retention.md for the full cardinality
 * analysis and why bounded, scheduled cleanup (7G.2.6) exists specifically
 * because of this.
 *
 * The three per-scope increments always happen in the same fixed order --
 * SOURCE, then TARGET, then GLOBAL -- for every caller, so concurrent
 * requests contending for overlapping bucket rows can never form a
 * circular wait (the standard deadlock-avoidance technique: consistent
 * lock/acquisition ordering). Each individual increment is already atomic
 * at the row level (see the repository), and wrapping all three in one
 * Prisma transaction makes the three-scope decision a single coherent unit:
 * either all three increments are durably recorded together, or (on
 * failure) none are, so a retry after a partial failure cannot double-count.
 *
 * This never queries CircleMember, so it has no way to know whether a
 * target actually exists -- and does not need to, since the SOURCE and
 * GLOBAL scopes bound abuse regardless of target validity.
 *
 * Never throws. On any internal failure (missing/weak secret, database
 * error), returns `{ allowed: false }` -- fail closed. The credential
 * verifier must not be called, and no session may be issued, when this
 * returns `{ allowed: false }`.
 */
export async function checkMemberAuthenticationRateLimit(input: {
  source: TrustedMemberAuthSource;
  circleId: string;
  memberCode: string;
}): Promise<MemberAuthRateLimitDecision> {
  const secret = getRateLimitSecret();
  if (!secret) return { allowed: false };

  const targetMaterial = normalizeTargetMaterial(input.circleId, input.memberCode);

  const sourceKeyHash = hmacHex(secret, `SOURCE:${input.source.value}`);
  const targetKeyHash = hmacHex(secret, `TARGET:${targetMaterial}`);
  const globalKeyHash = hmacHex(secret, `GLOBAL:${GLOBAL_KEY_MATERIAL}`);

  try {
    const counts = await prisma.$transaction(async (transaction) => {
      const source = await incrementRateLimitBucket(transaction, {
        scope: "SOURCE",
        keyHash: sourceKeyHash,
        windowSeconds: POLICY.SOURCE.windowSeconds,
      });
      const target = await incrementRateLimitBucket(transaction, {
        scope: "TARGET",
        keyHash: targetKeyHash,
        windowSeconds: POLICY.TARGET.windowSeconds,
      });
      const global = await incrementRateLimitBucket(transaction, {
        scope: "GLOBAL",
        keyHash: globalKeyHash,
        windowSeconds: POLICY.GLOBAL.windowSeconds,
      });

      return {
        source: source.attemptCount,
        target: target.attemptCount,
        global: global.attemptCount,
      };
    });

    const allowed =
      counts.source <= POLICY.SOURCE.limit &&
      counts.target <= POLICY.TARGET.limit &&
      counts.global <= POLICY.GLOBAL.limit;

    return { allowed };
  } catch (error) {
    console.error(
      "[checkMemberAuthenticationRateLimit] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { allowed: false };
  }
}
