import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireCircleMember } from "@/src/auth/require-circle-member";

// Orchestration tests only, via dependency injection -- exactly the pattern
// used for the login orchestration in circle-member-login.service.test.ts.
// validateCircleMemberSession's own rules (expiry, revocation, member
// status, credentialVersion, circle-status allowlist) are already covered
// live in circle-member-session.service.test.ts and are NOT re-verified
// here; this file verifies only what requireCircleMember adds on top:
// deriving memberId solely from the session, the cross-circle check, and
// uniform redirect-on-failure behavior. "Removed member", "DRAFT/CANCELLED
// circle", and "ACTIVE/COMPLETED/ARCHIVED allowed" are exercised here by
// simulating what validateCircleMemberSession already returns for each of
// those cases ({ valid: false } for the deny cases, { valid: true, ...}
// for the allow cases) -- proving requireCircleMember neither second-
// guesses nor loosens that verdict.

class TestRedirectSignal extends Error {
  readonly destination: string;

  constructor(destination: string) {
    super(`redirect:${destination}`);
    this.destination = destination;
  }
}

function buildDeps(overrides: Partial<Parameters<typeof requireCircleMember>[1]> = {}) {
  return {
    readSessionCookie: async () => "raw-token-value",
    validateSession: async () =>
      ({
        valid: true as const,
        identity: { circleId: "circle-1", memberId: "member-1" },
      }),
    redirectToLogin: (): never => {
      throw new TestRedirectSignal("/member/login");
    },
    ...overrides,
  };
}

// --- valid member session ---

test("a valid session for the requested circle returns circleId and memberId", async () => {
  const result = await requireCircleMember("circle-1", buildDeps());
  assert.deepEqual(result, { circleId: "circle-1", memberId: "member-1" });
});

// --- missing/invalid session ---

test("no session cookie redirects to /member/login without calling validateSession", async () => {
  let validateCalled = false;
  const deps = buildDeps({
    readSessionCookie: async () => undefined,
    validateSession: async () => {
      validateCalled = true;
      return { valid: true as const, identity: { circleId: "circle-1", memberId: "member-1" } };
    },
  });

  await assert.rejects(() => requireCircleMember("circle-1", deps), TestRedirectSignal);
  assert.equal(validateCalled, false);
});

test("an invalid session (validateSession says valid:false) redirects to /member/login", async () => {
  const deps = buildDeps({ validateSession: async () => ({ valid: false as const }) });
  await assert.rejects(() => requireCircleMember("circle-1", deps), TestRedirectSignal);
});

// --- expired/revoked session ---
// validateCircleMemberSession collapses expired and revoked sessions into
// the same { valid: false } result (see circle-member-session-contract.md,
// "Failure behavior") -- requireCircleMember has no separate code path for
// them, so this is the same case as "invalid session" above, exercised
// once more explicitly per the ticket's test list.

test("an expired-or-revoked session (still just valid:false) redirects to /member/login", async () => {
  const deps = buildDeps({ validateSession: async () => ({ valid: false as const }) });
  await assert.rejects(() => requireCircleMember("circle-1", deps), TestRedirectSignal);
});

// --- removed member / DRAFT / CANCELLED circle denied ---
// Each of these is already denied INSIDE validateCircleMemberSession itself
// (member.status !== "ACTIVE", or circle.status not in the eligible
// allowlist) -- from requireCircleMember's perspective they are indistinguishable
// from any other invalid session.

test("a removed member (surfaced as valid:false) redirects to /member/login", async () => {
  const deps = buildDeps({ validateSession: async () => ({ valid: false as const }) });
  await assert.rejects(() => requireCircleMember("circle-1", deps), TestRedirectSignal);
});

test("a DRAFT or CANCELLED circle (surfaced as valid:false) redirects to /member/login", async () => {
  const deps = buildDeps({ validateSession: async () => ({ valid: false as const }) });
  await assert.rejects(() => requireCircleMember("circle-1", deps), TestRedirectSignal);
});

// --- ACTIVE/COMPLETED/ARCHIVED allowed ---
// requireCircleMember does not re-check circle status at all -- it trusts
// validateCircleMemberSession's verdict outright, for any circle status
// that verdict was already computed against.

test("requireCircleMember allows access whenever validateSession says valid:true, regardless of which eligible circle status produced it", async () => {
  for (const circleId of ["active-circle", "completed-circle", "archived-circle"]) {
    const deps = buildDeps({
      validateSession: async () => ({
        valid: true as const,
        identity: { circleId, memberId: "member-1" },
      }),
    });

    const result = await requireCircleMember(circleId, deps);
    assert.deepEqual(result, { circleId, memberId: "member-1" });
  }
});

// --- cross-circle access denied ---

test("a valid session for a different circle than requested redirects to /member/login", async () => {
  const deps = buildDeps({
    validateSession: async () => ({
      valid: true as const,
      identity: { circleId: "circle-A", memberId: "member-1" },
    }),
  });

  await assert.rejects(() => requireCircleMember("circle-B", deps), TestRedirectSignal);
});

// --- no client-supplied memberId ---

test("the returned memberId always comes from the session, never from anything else the caller passed", async () => {
  const deps = buildDeps({
    validateSession: async () => ({
      valid: true as const,
      identity: { circleId: "circle-1", memberId: "session-derived-member" },
    }),
  });

  const result = await requireCircleMember("circle-1", deps);
  assert.equal(result.memberId, "session-derived-member");
});

test("requireCircleMember's signature has no memberId parameter at all", () => {
  assert.equal(requireCircleMember.length, 1, "expected exactly one required parameter (circleId)");
});

// --- no sensitive fields returned ---

test("the return value contains exactly circleId and memberId, nothing else", async () => {
  const result = await requireCircleMember("circle-1", buildDeps());
  assert.deepEqual(Object.keys(result).sort(), ["circleId", "memberId"]);
});

// --- structural checks on the actual source ---

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const moduleSource = stripComments(
  readFileSync(new URL("./require-circle-member.ts", import.meta.url), "utf8"),
);

test("no platform Auth.js dependency", () => {
  assert.doesNotMatch(moduleSource, /next-auth/);
  assert.doesNotMatch(moduleSource, /["']@\/auth["']/);
});

test("the module never references pinHash, memberCode, email, or session token/metadata fields", () => {
  for (const forbidden of ["pinHash", "memberCode", "email", "tokenHash", "expiresAt", "revokedAt", "lastUsedAt", "displayName", "payoutOrder"]) {
    assert.doesNotMatch(moduleSource, new RegExp(forbidden));
  }
});

test("the redirect target is exactly /member/login", () => {
  assert.match(moduleSource, /redirect\(\s*["']\/member\/login["']\s*\)/);
});
