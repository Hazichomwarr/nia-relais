import assert from "node:assert/strict";
import test from "node:test";

import { InvalidDraftCircleError } from "@/src/services/circle.service";
import {
  runCreateDraftCircleAction,
  type CreateDraftCircleDependencies,
  type TrustedOwner,
} from "@/src/actions/create-draft-circle";

// Orchestration tests via dependency injection, matching the pattern used
// for the member login orchestration (circle-member-login.service.test.ts):
// no real requireUser()/next-navigation/database is ever touched here.

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    name: "Family Susu",
    currency: "USD",
    contributionAmount: "100.00",
    frequency: "MONTHLY",
    startDate: "2099-01-01",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<CreateDraftCircleDependencies> = {}) {
  const calls = { requireUser: 0, createDraftCircle: 0 };
  let capturedInput: unknown;

  const deps: CreateDraftCircleDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    createDraftCircle: async (input) => {
      calls.createDraftCircle += 1;
      capturedInput = input;
      return {
        id: "circle-1",
        name: input.input.name,
        currency: input.input.currency,
        contributionAmount: input.input.contributionAmount,
        frequency: input.input.frequency,
        startDate: input.input.startDate,
        status: "DRAFT",
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// A. unauthenticated request denied
test("an unauthenticated caller (requireUser rejects) is denied, and the service is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal("redirect:/login");
    },
  });

  await assert.rejects(() => runCreateDraftCircleAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.createDraftCircle, 0);
});

// B. valid five-field payload
test("a valid five-field submission succeeds and returns the created circleId", async () => {
  const { deps } = buildDeps();
  const result = await runCreateDraftCircleAction(validFormData(), deps);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.circleId, "circle-1");
});

// C. ownerId comes only from requireUser
test("ownerId passed to createDraftCircle is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runCreateDraftCircleAction(validFormData({ ownerId: "attacker-supplied-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

// D. forged ownerId/status/provenance ignored
test("forged ownerId/status/activatedAt form fields never reach createDraftCircle's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runCreateDraftCircleAction(
    validFormData({
      ownerId: "attacker-owner",
      status: "ACTIVE",
      activatedAt: "2020-01-01T00:00:00.000Z",
      activatedById: "attacker-owner",
    }),
    deps,
  );

  const captured = getCapturedInput() as { ownerId: string; input: Record<string, unknown> };
  assert.equal(captured.ownerId, "owner-1");
  assert.deepEqual(Object.keys(captured.input).sort(), [
    "contributionAmount",
    "currency",
    "frequency",
    "name",
    "startDate",
  ]);
});

// E. invalid amount/currency/frequency/date rejected
test("an unsupported currency is rejected with a field error and never reaches the service", async () => {
  const { deps, calls } = buildDeps();
  const result = await runCreateDraftCircleAction(validFormData({ currency: "JPY" }), deps);

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.state.fieldErrors?.currency);
  assert.equal(calls.createDraftCircle, 0);
});

test("an unsupported frequency is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runCreateDraftCircleAction(validFormData({ frequency: "DAILY" }), deps);

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.state.fieldErrors?.frequency);
  assert.equal(calls.createDraftCircle, 0);
});

test("a zero/malformed contribution amount is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const zero = await runCreateDraftCircleAction(validFormData({ contributionAmount: "0.00" }), deps);
  const malformed = await runCreateDraftCircleAction(validFormData({ contributionAmount: "abc" }), deps);

  assert.equal(zero.ok, false);
  assert.equal(malformed.ok, false);
  assert.equal(calls.createDraftCircle, 0);
});

test("a past start date is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runCreateDraftCircleAction(validFormData({ startDate: "2000-01-01" }), deps);

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.state.fieldErrors?.startDate);
  assert.equal(calls.createDraftCircle, 0);
});

// F. service called exactly once on valid submission
test("createDraftCircle is called exactly once for one valid submission", async () => {
  const { deps, calls } = buildDeps();
  await runCreateDraftCircleAction(validFormData(), deps);

  assert.equal(calls.createDraftCircle, 1);
  assert.equal(calls.requireUser, 1);
});

// G. safe validation/service error mapping
test("a known InvalidDraftCircleError maps to a safe form-level error with its own message", async () => {
  const { deps } = buildDeps({
    createDraftCircle: async () => {
      throw new InvalidDraftCircleError("Circle details are invalid.");
    },
  });

  const result = await runCreateDraftCircleAction(validFormData(), deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.state.formError, "Circle details are invalid.");
});

test("an unexpected error maps to a generic fallback message, never leaking the raw error text", async () => {
  const { deps } = buildDeps({
    createDraftCircle: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runCreateDraftCircleAction(validFormData(), deps);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.state.formError, "We could not create your circle. Please try again.");
    assert.doesNotMatch(result.state.formError ?? "", /secret|database|connection/);
  }
});

// no member/session identity dependency
test("this module never imports the member-session identity system", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./create-draft-circle.ts", import.meta.url), "utf8");
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session", "next-auth"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

// no domain/schema mutation outside existing createDraftCircle
test("this module references no Prisma client and no other circle-mutating service function", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./create-draft-circle.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of ["addDraftCircleMember", "removeDraftCircleMember", "setDraftCirclePayoutOrder", "activateCircle"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
