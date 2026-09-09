import "server-only";
import { isIP } from "node:net";

// Implements the approved trust boundary in
// docs/security/trusted-member-auth-source-contract.md. Do not add another
// header here, and do not change the precedence order below, without
// updating that contract first.

const VERCEL_TRUSTED_SOURCE_HEADER = "x-vercel-forwarded-for";
const TEST_OVERRIDE_HEADER = "x-nia-test-source";
const TEST_OVERRIDE_FLAG = "ALLOW_TEST_AUTH_SOURCE";

declare const trustedMemberAuthSourceBrand: unique symbol;

/**
 * A normalized, trusted source identity for the future member-auth rate
 * limiter. Callers cannot construct this type themselves -- the branding
 * field below is not exported, so only `getTrustedMemberAuthSource` in this
 * module can produce a value that type-checks as one. It intentionally
 * carries nothing but the normalized address: no memberCode, PIN, User
 * identity, circleId, or raw header value.
 */
export type TrustedMemberAuthSource = {
  readonly value: string;
  readonly establishedBy: "vercel-edge" | "test-override";
  readonly [trustedMemberAuthSourceBrand]: true;
};

export type TrustedMemberAuthSourceResult =
  | { readonly ok: true; readonly source: TrustedMemberAuthSource }
  | { readonly ok: false };

function brandSource(
  value: string,
  establishedBy: TrustedMemberAuthSource["establishedBy"],
): TrustedMemberAuthSource {
  return { value, establishedBy } as TrustedMemberAuthSource;
}

/**
 * Accepts only a single, syntactically valid IPv4 or IPv6 address. Uses
 * Node's built-in `net.isIP` (a real parser) rather than a hand-written
 * regex or string split. A comma-separated list -- which would only occur
 * if a proxy sat in front of Vercel, contradicting the topology this
 * contract assumes -- is rejected outright rather than guessing which
 * position in the list is trustworthy.
 */
function normalizeSingleIp(rawValue: string | null): string | null {
  if (!rawValue) return null;

  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed.includes(",")) return null;

  const candidate = trimmed.toLowerCase();
  return isIP(candidate) !== 0 ? candidate : null;
}

/**
 * The test-only override requires TWO independent conditions, not just the
 * feature flag, so that accidentally enabling the flag in a real Vercel
 * environment cannot activate it:
 *
 *   1. `ALLOW_TEST_AUTH_SOURCE` is explicitly set.
 *   2. `NODE_ENV !== "production"`.
 *
 * `NODE_ENV` is chosen over Vercel's own `VERCEL` / `VERCEL_ENV` system
 * variables deliberately: those require a separate "Enable access to System
 * Environment Variables" project setting to be exposed at runtime at all,
 * so depending on them here would make this guard silently do nothing if
 * that unrelated setting is ever toggled off. `NODE_ENV=production` is set
 * by Next.js's own build/runtime for every real Vercel deployment --
 * Production and Preview alike -- with no such dependency, so it blocks the
 * override in both, not just Production.
 */
function isTestOverrideAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env[TEST_OVERRIDE_FLAG] === "1";
}

/**
 * Converts an incoming request into NIA's trusted member-auth source
 * identity. Never throws for an untrusted, missing, or malformed source --
 * callers must check `result.ok` and fail closed (no rate-limit read, no
 * credential verification, no session issuance) when it is `false`.
 *
 * The Vercel-edge header is always checked first and, if valid, always
 * wins -- the test-only header is never even read when it is present, so a
 * test header can never override a genuine trusted production source.
 */
export function getTrustedMemberAuthSource(request: Request): TrustedMemberAuthSourceResult {
  const vercelValue = normalizeSingleIp(request.headers.get(VERCEL_TRUSTED_SOURCE_HEADER));
  if (vercelValue) {
    return { ok: true, source: brandSource(vercelValue, "vercel-edge") };
  }

  if (isTestOverrideAllowed()) {
    const testValue = normalizeSingleIp(request.headers.get(TEST_OVERRIDE_HEADER));
    if (testValue) {
      return { ok: true, source: brandSource(testValue, "test-override") };
    }
  }

  return { ok: false };
}
