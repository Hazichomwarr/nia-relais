import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isValidSuperAdminUserId,
  isVerifiedSuperAdmin,
  requireSuperAdmin,
  type RequireSuperAdminDependencies,
} from "./require-super-admin";

const founder = { id: "caaaaaaaaaaaaaaaaaaaaaaaa", name: "Founder" };
const ordinaryUser = { id: "cbbbbbbbbbbbbbbbbbbbbbbbb", name: "Ordinary" };

class RedirectSignal extends Error {
  readonly destination: string;

  constructor(destination: string) {
    super(`redirect:${destination}`);
    this.destination = destination;
  }
}

function dependencies(overrides: Partial<RequireSuperAdminDependencies> = {}): RequireSuperAdminDependencies {
  return {
    getVerifiedUser: async () => founder,
    readConfiguredUserId: () => founder.id,
    redirectToLogin: (): never => { throw new RedirectSignal("/login"); },
    redirectToHome: (): never => { throw new RedirectSignal("/dashboard"); },
    ...overrides,
  };
}

test("allows only the verified configured founder id", async () => {
  assert.deepEqual(await requireSuperAdmin(dependencies()), founder);
  assert.equal(isVerifiedSuperAdmin(founder, founder.id), true);
});

test("no platform session is denied through the existing login path", async () => {
  await assert.rejects(() => requireSuperAdmin(dependencies({ getVerifiedUser: async () => null })), RedirectSignal);
});

test("an ordinary verified platform user is denied without leaking admin state", async () => {
  await assert.rejects(() => requireSuperAdmin(dependencies({ getVerifiedUser: async () => ordinaryUser })), RedirectSignal);
});

test("missing, empty, and malformed admin configuration fail closed", async () => {
  for (const configuredId of [undefined, "", " ", "founder@example.com", "CAAAAAAAAAAAAAAAAAAAAAAAA"]) {
    await assert.rejects(() => requireSuperAdmin(dependencies({ readConfiguredUserId: () => configuredId })), RedirectSignal);
  }
  assert.equal(isValidSuperAdminUserId(founder.id), true);
  assert.equal(isValidSuperAdminUserId("founder@example.com"), false);
});

test("a deleted or stale database identity and database verification failure are denied", async () => {
  await assert.rejects(() => requireSuperAdmin(dependencies({ getVerifiedUser: async () => null })), RedirectSignal);
  await assert.rejects(() => requireSuperAdmin(dependencies({ getVerifiedUser: async () => { throw new Error("database unavailable"); } })), RedirectSignal);
});

test("forged session flags and SUSU-only identity data never grant platform admin access", async () => {
  const forged = { ...ordinaryUser, isAdmin: true, memberId: "member-only-id" } as typeof ordinaryUser;
  await assert.rejects(() => requireSuperAdmin(dependencies({ getVerifiedUser: async () => forged })), RedirectSignal);
  assert.equal(isVerifiedSuperAdmin(null, founder.id), false);
});

const source = readFileSync(new URL("./require-super-admin.ts", import.meta.url), "utf8");

test("the central guard is server-only and has no email, member, or client-flag authorization path", () => {
  assert.match(source, /import "server-only"/);
  assert.match(source, /getVerifiedUser/);
  for (const forbidden of ["next-auth", "email", "memberId", "isAdmin", "localStorage", "headers"]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});
