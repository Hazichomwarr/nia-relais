import assert from "node:assert/strict";
import test from "node:test";

import {
  DraftCircleMemberCodeGenerationError,
  DraftCircleMembershipAuthorizationError,
  DraftCircleMembershipConflictError,
  DraftCircleMemberNotFoundError,
  InvalidDraftCircleError,
} from "@/src/services/circle.service";
import {
  runAddDraftCircleMemberAction,
  type AddDraftCircleMemberDependencies,
  type TrustedOwner,
} from "@/src/actions/add-draft-circle-member";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    displayName: "Amara",
    email: "amara@example.invalid",
    pin: "123456",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<AddDraftCircleMemberDependencies> = {}) {
  const calls = { requireUser: 0, addDraftCircleMember: 0 };
  let capturedInput: unknown;

  const deps: AddDraftCircleMemberDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    addDraftCircleMember: async (input) => {
      calls.addDraftCircleMember += 1;
      capturedInput = input;
      return {
        id: "member-1",
        circleId: input.circleId,
        displayName: input.input.displayName,
        email: input.input.email ?? null,
        memberCode: "ABCDEF0123456789",
        payoutOrder: null,
        status: "ACTIVE",
        addedAt: new Date().toISOString(),
        removedAt: null,
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// unauthenticated add denied
test("an unauthenticated caller is denied, and the service is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runAddDraftCircleMemberAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.addDraftCircleMember, 0);
});

// authenticated owner can add a member
test("a valid submission succeeds and returns the member's safe identity and memberCode, never pinHash", async () => {
  const { deps } = buildDeps();
  const result = await runAddDraftCircleMemberAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.deepEqual(result.member, { id: "member-1", displayName: "Amara", memberCode: "ABCDEF0123456789" });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "pinHash"), false);
});

// forged ownerId/userId/status/provenance ignored
test("forged ownerId/status/userId/provenance form fields never reach the service's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runAddDraftCircleMemberAction(
    validFormData({ ownerId: "attacker-owner", status: "ACTIVE", userId: "attacker-user", payoutOrder: "1" }),
    deps,
  );

  const captured = getCapturedInput() as { ownerId: string; circleId: string; input: Record<string, unknown> };
  assert.equal(captured.ownerId, "owner-1");
  assert.deepEqual(Object.keys(captured.input).sort(), ["displayName", "email", "pin"]);
});

test("ownerId passed to the service is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runAddDraftCircleMemberAction(validFormData(), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

// invalid name/email/PIN rejected
test("a missing display name is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runAddDraftCircleMemberAction(validFormData({ displayName: "" }), deps);

  assert.equal(result.status, undefined);
  assert.ok(result.fieldErrors?.displayName);
  assert.equal(calls.addDraftCircleMember, 0);
});

test("an invalid email is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runAddDraftCircleMemberAction(validFormData({ email: "not-an-email" }), deps);

  assert.ok(result.fieldErrors?.email);
  assert.equal(calls.addDraftCircleMember, 0);
});

test("a non-six-digit PIN is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const short = await runAddDraftCircleMemberAction(validFormData({ pin: "123" }), deps);
  const nonNumeric = await runAddDraftCircleMemberAction(validFormData({ pin: "12345a" }), deps);

  assert.ok(short.fieldErrors?.pin);
  assert.ok(nonNumeric.fieldErrors?.pin);
  assert.equal(calls.addDraftCircleMember, 0);
});

// exactly-once service invocation
test("addDraftCircleMember is called exactly once for one valid submission", async () => {
  const { deps, calls } = buildDeps();
  await runAddDraftCircleMemberAction(validFormData(), deps);

  assert.equal(calls.addDraftCircleMember, 1);
  assert.equal(calls.requireUser, 1);
});

// safe expected/unexpected error mapping
test("not-found and authorization errors collapse to the same generic message, never distinguishing them", async () => {
  const { deps: notFoundDeps } = buildDeps({
    addDraftCircleMember: async () => {
      throw new DraftCircleMemberNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    addDraftCircleMember: async () => {
      throw new DraftCircleMembershipAuthorizationError();
    },
  });

  const notFoundResult = await runAddDraftCircleMemberAction(validFormData(), notFoundDeps);
  const authResult = await runAddDraftCircleMemberAction(validFormData(), authDeps);

  assert.equal(notFoundResult.formError, "We could not find this circle.");
  assert.equal(authResult.formError, "We could not find this circle.");
});

test("a conflict (circle no longer DRAFT) maps to its own informative message", async () => {
  const { deps } = buildDeps({
    addDraftCircleMember: async () => {
      throw new DraftCircleMembershipConflictError();
    },
  });

  const result = await runAddDraftCircleMemberAction(validFormData(), deps);
  assert.equal(result.formError, "Members can only be added while the circle is still a draft.");
});

test("a code-generation failure surfaces the service's own safe message", async () => {
  const { deps } = buildDeps({
    addDraftCircleMember: async () => {
      throw new DraftCircleMemberCodeGenerationError();
    },
  });

  const result = await runAddDraftCircleMemberAction(validFormData(), deps);
  assert.equal(result.formError, "A secure member code could not be generated. Please try again.");
});

test("an InvalidDraftCircleError surfaces its own message", async () => {
  const { deps } = buildDeps({
    addDraftCircleMember: async () => {
      throw new InvalidDraftCircleError("Member details are invalid.");
    },
  });

  const result = await runAddDraftCircleMemberAction(validFormData(), deps);
  assert.equal(result.formError, "Member details are invalid.");
});

test("an unexpected error maps to a generic fallback, never leaking the raw error text", async () => {
  const { deps } = buildDeps({
    addDraftCircleMember: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runAddDraftCircleMemberAction(validFormData(), deps);
  assert.equal(result.formError, "We could not add this member. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// no member/session identity dependency, no domain mutation outside addDraftCircleMember
test("this module never imports the member-session identity system or any other circle-mutating service", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./add-draft-circle-member.ts", import.meta.url), "utf8");
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session", "next-auth", "prisma.", "removeDraftCircleMember", "setDraftCirclePayoutOrder", "activateCircle"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
