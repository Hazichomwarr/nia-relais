import assert from "node:assert/strict";
import test from "node:test";

import {
  DraftCircleMembershipAuthorizationError,
  DraftCircleMembershipConflictError,
  DraftCircleMemberNotFoundError,
} from "@/src/services/circle.service";
import {
  runRemoveDraftCircleMemberAction,
  type RemoveDraftCircleMemberDependencies,
  type TrustedOwner,
} from "@/src/actions/remove-draft-circle-member";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function formData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { circleId: "circle-1", memberId: "member-1", ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<RemoveDraftCircleMemberDependencies> = {}) {
  const calls = { requireUser: 0, removeDraftCircleMember: 0 };
  let capturedInput: unknown;

  const deps: RemoveDraftCircleMemberDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    removeDraftCircleMember: async (input) => {
      calls.removeDraftCircleMember += 1;
      capturedInput = input;
      return {
        id: input.memberId,
        circleId: input.circleId,
        displayName: "Amara",
        email: null,
        memberCode: "ABCDEF0123456789",
        payoutOrder: null,
        status: "REMOVED",
        addedAt: new Date().toISOString(),
        removedAt: new Date().toISOString(),
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// unauthenticated remove denied
test("an unauthenticated caller is denied, and the service is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runRemoveDraftCircleMemberAction(formData(), deps), TestRedirectSignal);
  assert.equal(calls.removeDraftCircleMember, 0);
});

// removal delegates to existing service
test("a valid removal delegates to removeDraftCircleMember exactly once with the trusted ownerId", async () => {
  const { deps, calls, getCapturedInput } = buildDeps();
  const outcome = await runRemoveDraftCircleMemberAction(formData(), deps);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.circleId, "circle-1");
  assert.equal(calls.removeDraftCircleMember, 1);

  const captured = getCapturedInput() as { ownerId: string; circleId: string; memberId: string };
  assert.deepEqual(captured, { ownerId: "owner-1", circleId: "circle-1", memberId: "member-1" });
});

// forged ownerId ignored
test("ownerId always comes from requireUser, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRemoveDraftCircleMemberAction(formData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

// cross-owner mutation denied / stale DRAFT mutation rejected after activation
test("not-found, authorization, and conflict errors all collapse to { ok: false }, never distinguished", async () => {
  for (const ErrorClass of [DraftCircleMemberNotFoundError, DraftCircleMembershipAuthorizationError, DraftCircleMembershipConflictError]) {
    const { deps } = buildDeps({
      removeDraftCircleMember: async () => {
        throw new ErrorClass();
      },
    });
    const outcome = await runRemoveDraftCircleMemberAction(formData(), deps);
    assert.deepEqual(outcome, { ok: false, circleId: "circle-1" });
  }
});

test("an unexpected error also resolves to { ok: false } rather than throwing to the caller", async () => {
  const { deps } = buildDeps({
    removeDraftCircleMember: async () => {
      throw new Error("unexpected database failure");
    },
  });

  const outcome = await runRemoveDraftCircleMemberAction(formData(), deps);
  assert.equal(outcome.ok, false);
});

test("a missing circleId or memberId is rejected without calling the service", async () => {
  const { deps, calls } = buildDeps();
  const noCircle = await runRemoveDraftCircleMemberAction(formData({ circleId: "" }), deps);
  const noMember = await runRemoveDraftCircleMemberAction(formData({ memberId: "" }), deps);

  assert.equal(noCircle.ok, false);
  assert.equal(noMember.ok, false);
  assert.equal(calls.removeDraftCircleMember, 0);
});

test("this module never imports the member-session identity system or any other circle-mutating service", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./remove-draft-circle-member.ts", import.meta.url), "utf8");
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session", "next-auth", "prisma.", "addDraftCircleMember", "setDraftCirclePayoutOrder", "activateCircle"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
