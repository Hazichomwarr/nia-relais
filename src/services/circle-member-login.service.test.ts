import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CircleMemberAuthenticationError } from "@/src/services/circle-member-auth.service";
import { loginCircleMember } from "@/src/services/circle-member-login.service";

// Orchestration tests: this file never touches the live database. Every
// dependency (trusted source, rate limiter, credential verifier, session
// issuance) is a hand-written test double injected via loginCircleMember's
// second argument -- plain function substitution, not module mocking -- per
// the ticket's own instruction ("Use mocks for orchestration tests where
// appropriate. Do not run destructive shared-database tests."). Each
// already-independently-tested real service keeps its own live-DB test
// suite elsewhere (circle-member-auth-rate-limit.service.test.ts,
// circle-member-session.service.test.ts, etc.) -- this file tests ONLY the
// wiring between them: order, short-circuiting, and failure shape.

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test/api/member/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { circleId: "c".padEnd(25, "0"), memberCode: "ABCDEF0123456789", pin: "123456" };

function trackedCallLog() {
  const calls: string[] = [];
  return { calls, record: (name: string) => calls.push(name) };
}

function buildDeps(overrides: Partial<Parameters<typeof loginCircleMember>[1]> = {}) {
  const { calls, record } = trackedCallLog();

  const deps = {
    getTrustedSource: () => {
      record("source");
      return { ok: true as const, source: { value: "203.0.113.10", establishedBy: "test-override" as const } as never };
    },
    checkRateLimit: async () => {
      record("rateLimit");
      return { allowed: true };
    },
    verifyCredentials: async () => {
      record("verify");
      return { circleId: "verified-circle", memberId: "verified-member", credentialVersion: 1 };
    },
    createSession: async () => {
      record("session");
      return {
        sessionId: "session-1",
        rawToken: "raw-token-value",
        circleId: "verified-circle",
        memberId: "verified-member",
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      };
    },
    ...overrides,
  };

  return { deps, calls };
}

// A: valid login creates a session.
test("valid credentials produce ok:true with the session's raw token and expiry", async () => {
  const { deps, calls } = buildDeps();

  const result = await loginCircleMember(jsonRequest(VALID_BODY), deps);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rawToken, "raw-token-value");
    assert.ok(result.expiresAt.length > 0);
  }
  assert.deepEqual(calls, ["source", "rateLimit", "verify", "session"]);
});

// B/C/D/E: invalid PIN, unknown member, removed member, DRAFT circle --
// the verifier throws CircleMemberAuthenticationError uniformly for every
// one of these (verified directly in circle-member-auth.service.ts's own
// test suite); at the orchestration boundary they are indistinguishable by
// design, so one test stands in for all four failure causes.
test("any credential-verification failure produces ok:false and never issues a session", async () => {
  const { deps, calls } = buildDeps({
    verifyCredentials: async () => {
      calls.push("verify");
      throw new CircleMemberAuthenticationError();
    },
  });

  const result = await loginCircleMember(jsonRequest(VALID_BODY), deps);

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["source", "rateLimit", "verify"]);
});

test("an unexpected (non-authentication) error from the verifier is not swallowed", async () => {
  const boom = new Error("unexpected database failure");
  const { deps } = buildDeps({
    verifyCredentials: async () => {
      throw boom;
    },
  });

  await assert.rejects(() => loginCircleMember(jsonRequest(VALID_BODY), deps), boom);
});

// F: source failure stops before the limiter and the verifier.
test("a failed trusted-source lookup stops before the rate limiter and the verifier", async () => {
  const { deps, calls } = buildDeps({
    getTrustedSource: () => {
      calls.push("source");
      return { ok: false as const };
    },
  });

  const result = await loginCircleMember(jsonRequest(VALID_BODY), deps);

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["source"]);
});

// G (and, from the orchestrator's point of view, H: a missing rate-limit
// secret is indistinguishable from an exceeded limit -- both surface as
// `{ allowed: false }` from checkMemberAuthenticationRateLimit itself, per
// its own fail-closed contract tested in circle-member-auth-rate-limit
// .service.test.ts). Either way, the verifier must never run.
test("a rate-limit denial stops before the verifier and issues no session", async () => {
  const { deps, calls } = buildDeps({
    checkRateLimit: async () => {
      calls.push("rateLimit");
      return { allowed: false };
    },
  });

  const result = await loginCircleMember(jsonRequest(VALID_BODY), deps);

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["source", "rateLimit"]);
});

// M: if verification succeeds but session issuance fails, the failure is
// generic, no cookie-worthy result is returned, and there is no automatic
// retry of credential verification.
test("a session-issuance failure after successful verification is generic and does not retry verification", async () => {
  const { deps, calls } = buildDeps({
    createSession: async () => {
      calls.push("session");
      throw new Error("session write failed");
    },
  });

  const result = await loginCircleMember(jsonRequest(VALID_BODY), deps);

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["source", "rateLimit", "verify", "session"]);
});

// L: session issuance uses only the verifier's own trusted output, never
// the raw client-supplied circleId/memberCode/pin.
test("session issuance is called with the verifier's trusted identity, not the client-supplied body", async () => {
  let capturedInput: unknown;
  const { deps } = buildDeps({
    createSession: async (input) => {
      capturedInput = input;
      return {
        sessionId: "session-1",
        rawToken: "raw-token-value",
        circleId: "verified-circle",
        memberId: "verified-member",
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      };
    },
  });

  await loginCircleMember(
    jsonRequest({ circleId: "client-supplied-circle", memberCode: "CLIENTCODE000000", pin: "999999" }),
    deps,
  );

  assert.deepEqual(capturedInput, {
    circleId: "verified-circle",
    memberId: "verified-member",
    credentialVersion: 1,
  });
});

// Malformed/oversized/wrong-typed request bodies never throw out of the
// orchestrator -- they still reach the rate limiter (bounded) with an empty
// string in place of anything that failed to parse.
test("a malformed request body is bounded to empty strings rather than throwing", async () => {
  let capturedRateLimitInput: { circleId: string; memberCode: string } | undefined;
  const { deps } = buildDeps({
    checkRateLimit: async (input: { circleId: string; memberCode: string; source: unknown }) => {
      capturedRateLimitInput = input;
      return { allowed: true };
    },
  });

  const request = new Request("https://example.test/api/member/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ circleId: 12345, unrelated: "x".repeat(10_000) }),
  });

  await loginCircleMember(request, deps);

  assert.equal(capturedRateLimitInput?.circleId, "");
  assert.equal(capturedRateLimitInput?.memberCode, "");
});

test("a non-JSON request body does not throw", async () => {
  const { deps, calls } = buildDeps();
  const request = new Request("https://example.test/api/member/auth/login", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "not json",
  });

  const result = await loginCircleMember(request, deps);

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["source", "rateLimit", "verify", "session"]);
});

// --- Structural checks on the route handler and the request schema ---
// These read the actual source text (not a description of it) for
// properties that are impractical to observe through a mocked unit test:
// cookie configuration reuse, absence of a raw-token leak in any JSON
// response, and isolation from platform Auth.js.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readSiblingSource(relativePath: string): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return readFileSync(new URL(relativePath, `file://${here}`), "utf8");
}

test("the route handler sets the cookie using the shared contract constants, not ad hoc options", () => {
  const source = readSiblingSource("../../app/api/member/auth/login/route.ts");
  const code = stripComments(source);

  assert.match(code, /CIRCLE_MEMBER_SESSION_COOKIE_NAME/);
  assert.match(code, /CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS/);
  // No inline httpOnly/secure/sameSite literals duplicating the contract.
  assert.doesNotMatch(code, /httpOnly\s*:/);
  assert.doesNotMatch(code, /sameSite\s*:/);
});

test("the route handler's JSON responses never reference the raw session token", () => {
  const source = readSiblingSource("../../app/api/member/auth/login/route.ts");
  const code = stripComments(source);

  const jsonCalls = code.match(/Response\.json\(([\s\S]*?)\)/g) ?? [];
  assert.ok(jsonCalls.length >= 2, "expected both a failure and a success Response.json call");
  for (const call of jsonCalls) {
    assert.doesNotMatch(call, /rawToken/);
    assert.doesNotMatch(call, /result\./);
  }
});

test("neither the route handler nor the login service imports platform Auth.js", () => {
  const routeSource = stripComments(readSiblingSource("../../app/api/member/auth/login/route.ts"));
  const serviceSource = stripComments(readFileSync(new URL("./circle-member-login.service.ts", import.meta.url), "utf8"));

  for (const source of [routeSource, serviceSource]) {
    assert.doesNotMatch(source, /next-auth/);
    assert.doesNotMatch(source, /["']@\/auth["']/);
  }
});

test("the login request schema has no field for identity, status, or session data the client could supply", () => {
  const serviceSource = stripComments(readFileSync(new URL("./circle-member-login.service.ts", import.meta.url), "utf8"));
  const schemaBlockMatch = serviceSource.match(/memberLoginBoundsSchema = z\.object\(\{([\s\S]*?)\}\);/);
  assert.ok(schemaBlockMatch, "expected to find memberLoginBoundsSchema's field list");

  const fields = schemaBlockMatch![1];
  assert.match(fields, /circleId/);
  assert.match(fields, /memberCode/);
  assert.match(fields, /pin/);
  for (const forbidden of ["userId", "memberId", "credentialVersion", "status"]) {
    assert.doesNotMatch(fields, new RegExp(forbidden));
  }
});

// N: no financial/domain mutation anywhere on this path.
test("neither the route handler nor the login service references any financial/domain model", () => {
  const routeSource = stripComments(readSiblingSource("../../app/api/member/auth/login/route.ts"));
  const serviceSource = stripComments(readFileSync(new URL("./circle-member-login.service.ts", import.meta.url), "utf8"));

  for (const source of [routeSource, serviceSource]) {
    for (const forbidden of ["Deposit", "Payout", "Contribution", "prisma.", "PersonalGoal"]) {
      assert.doesNotMatch(source, new RegExp(forbidden));
    }
  }
});
