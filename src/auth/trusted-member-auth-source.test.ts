import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTrustedMemberAuthSource } from "./trusted-member-auth-source.ts";

const TEST_FLAG = "ALLOW_TEST_AUTH_SOURCE";
const originalNodeEnv = process.env.NODE_ENV;
const originalFlag = process.env[TEST_FLAG];

function restoreEnv() {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalFlag === undefined) delete process.env[TEST_FLAG];
  else process.env[TEST_FLAG] = originalFlag;
}

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://example.invalid/", { headers });
}

test.afterEach(() => restoreEnv());

// A. valid trusted IPv4
test("A. accepts a valid IPv4 from x-vercel-forwarded-for", () => {
  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "203.0.113.5" }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source.value, "203.0.113.5");
    assert.equal(result.source.establishedBy, "vercel-edge");
  }
});

// B. valid trusted IPv6
test("B. accepts a valid IPv6 from x-vercel-forwarded-for", () => {
  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "2001:DB8::1" }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source.value, "2001:db8::1");
    assert.equal(result.source.establishedBy, "vercel-edge");
  }
});

// C. missing Vercel source rejected
test("C. rejects a request with no trusted header at all", () => {
  const result = getTrustedMemberAuthSource(requestWithHeaders({}));
  assert.equal(result.ok, false);
});

// D. malformed source rejected
test("D. rejects a malformed x-vercel-forwarded-for value", () => {
  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "not-an-ip" }),
  );
  assert.equal(result.ok, false);
});

test("D2. rejects a comma-separated list rather than guessing a hop position", () => {
  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "203.0.113.5, 198.51.100.9" }),
  );
  assert.equal(result.ok, false);
});

// E. arbitrary x-forwarded-for ignored
test("E. never reads x-forwarded-for, even when it is a valid IP", () => {
  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-forwarded-for": "198.51.100.7" }),
  );
  assert.equal(result.ok, false);
});

// F. arbitrary x-real-ip ignored
test("F. never reads x-real-ip, even when it is a valid IP", () => {
  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-real-ip": "198.51.100.8" }),
  );
  assert.equal(result.ok, false);
});

// G. test source accepted only under explicit non-production test mode
test("G. accepts the test header when NODE_ENV is not production and the flag is set", () => {
  process.env.NODE_ENV = "test";
  process.env[TEST_FLAG] = "1";

  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-nia-test-source": "192.0.2.10" }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source.value, "192.0.2.10");
    assert.equal(result.source.establishedBy, "test-override");
  }
});

test("G2. accepts the test header when NODE_ENV is unset and the flag is set (unset is not \"production\")", () => {
  delete process.env.NODE_ENV;
  process.env[TEST_FLAG] = "1";

  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-nia-test-source": "192.0.2.10" }),
  );

  // NODE_ENV unset is not "production", so this is expected to succeed.
  // Real Vercel deployments (Production and Preview) always set
  // NODE_ENV=production explicitly, so this case is documented here to make
  // the boundary visible, not because it is expected to occur in practice.
  assert.equal(result.ok, true);
});

test("G3. rejects the test header when NODE_ENV is non-production but the flag is not set", () => {
  process.env.NODE_ENV = "test";
  delete process.env[TEST_FLAG];

  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-nia-test-source": "192.0.2.10" }),
  );

  assert.equal(result.ok, false);
});

// H. test source ignored/rejected in production even if flag is enabled
test("H. rejects the test header when NODE_ENV is production, even with the flag enabled", () => {
  process.env.NODE_ENV = "production";
  process.env[TEST_FLAG] = "1";

  const result = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-nia-test-source": "192.0.2.10" }),
  );

  assert.equal(result.ok, false);
});

// I. test header cannot override trusted production signal
test("I. the Vercel header wins even when a differing test header is also present and override is allowed", () => {
  process.env.NODE_ENV = "test";
  process.env[TEST_FLAG] = "1";

  const result = getTrustedMemberAuthSource(
    requestWithHeaders({
      "x-vercel-forwarded-for": "203.0.113.5",
      "x-nia-test-source": "198.51.100.99",
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source.value, "203.0.113.5");
    assert.equal(result.source.establishedBy, "vercel-edge");
  }
});

// J. normalized output deterministic
test("J. equivalent inputs (whitespace, casing) normalize to the same value", () => {
  const a = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "  203.0.113.5  " }),
  );
  const b = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "203.0.113.5" }),
  );
  const c = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "2001:DB8::1" }),
  );
  const d = getTrustedMemberAuthSource(
    requestWithHeaders({ "x-vercel-forwarded-for": "2001:db8::1" }),
  );

  assert.ok(a.ok && b.ok && a.source.value === b.source.value);
  assert.ok(c.ok && d.ok && c.source.value === d.source.value);
});

// K. no persistence/database access; L. no credential verification;
// M. no session creation -- asserted structurally: the implementation file
// must not import anything from these forbidden surfaces at all.
test("K/L/M. the module imports nothing related to persistence, credentials, or sessions", () => {
  const modulePath = fileURLToPath(new URL("./trusted-member-auth-source.ts", import.meta.url));
  const source = readFileSync(modulePath, "utf8");

  const forbiddenImportSubstrings = [
    "@/src/prisma",
    "@prisma/client",
    "bcryptjs",
    "next-auth",
    "next/headers",
    "@/src/repositories",
    "@/src/services",
  ];

  for (const forbidden of forbiddenImportSubstrings) {
    assert.ok(
      !source.includes(forbidden),
      `expected trusted-member-auth-source.ts not to reference "${forbidden}"`,
    );
  }
});

// Explicitly deferred, not fabricated: whether a client attempting to set
// x-vercel-forwarded-for directly is actually overwritten by Vercel's own
// edge (rather than passed through) cannot be verified in a local unit
// test -- there is no real Vercel edge in this process to overwrite
// anything. That guarantee comes from Vercel's own documented behavior
// (docs/security/trusted-member-auth-source-contract.md, "Spoofed client
// header ignored/rejected") and can only be verified against a real
// Vercel preview deployment, per that contract's test plan. Not run here.
