import assert from "node:assert/strict";
import test from "node:test";

import {
  DraftCircleMembershipAuthorizationError,
  DraftCircleMembershipConflictError,
  DraftCircleMemberNotFoundError,
  DraftCirclePayoutOrderError,
  InvalidDraftCircleError,
} from "@/src/services/circle.service";
import {
  runSetDraftCirclePayoutOrderAction,
  type SetDraftCirclePayoutOrderDependencies,
  type TrustedOwner,
} from "@/src/actions/set-draft-circle-payout-order";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function formDataFor(circleId: string, memberIds: string[], extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("circleId", circleId);
  for (const memberId of memberIds) data.append("memberId", memberId);
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<SetDraftCirclePayoutOrderDependencies> = {}) {
  const calls = { requireUser: 0, setDraftCirclePayoutOrder: 0 };
  let capturedInput: unknown;

  const deps: SetDraftCirclePayoutOrderDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    setDraftCirclePayoutOrder: async (input) => {
      calls.setDraftCirclePayoutOrder += 1;
      capturedInput = input;
      return input.orderedMemberIds.map((id, index) => ({
        id,
        circleId: input.circleId,
        displayName: `Member ${index + 1}`,
        memberCode: `CODE${index}`.padEnd(16, "0"),
        payoutOrder: index + 1,
        status: "ACTIVE" as const,
      }));
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// B. unauthenticated submission denied
test("an unauthenticated caller is denied, and the service is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(
    () => runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1", "m2"]), deps),
    TestRedirectSignal,
  );
  assert.equal(calls.setDraftCirclePayoutOrder, 0);
});

// A. authenticated owner can save a valid complete order
test("a valid submission succeeds and returns the newly saved sequence", async () => {
  const { deps } = buildDeps();
  const result = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1", "m2", "m3"]), deps);

  assert.equal(result.status, "success");
  assert.deepEqual(
    result.members?.map((member) => member.id),
    ["m1", "m2", "m3"],
  );
  assert.deepEqual(
    result.members?.map((member) => member.payoutOrder),
    [1, 2, 3],
  );
});

// C. forged ownerId/status/payoutOrder/provenance ignored
test("forged ownerId/status/payoutOrder fields never reach the service's input; only circleId and the memberId sequence do", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runSetDraftCirclePayoutOrderAction(
    formDataFor("circle-1", ["m1", "m2"], { ownerId: "attacker-owner", status: "ACTIVE", payoutOrder: "99" }),
    deps,
  );

  const captured = getCapturedInput() as { ownerId: string; circleId: string; orderedMemberIds: string[] };
  assert.equal(captured.ownerId, "owner-1");
  assert.equal(captured.circleId, "circle-1");
  assert.deepEqual(captured.orderedMemberIds, ["m1", "m2"]);
});

test("ownerId passed to the service is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1"]), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

// D/E/F. structure/duplicate/malformed validation is the service's job,
// not re-implemented here -- confirmed by passing malformed input straight
// through and observing the service's own error surfaces correctly.
test("D/E/F. a malformed or duplicate sequence is not pre-validated here -- it is passed straight to the service, which rejects it", async () => {
  const { deps, calls } = buildDeps({
    setDraftCirclePayoutOrder: async () => {
      calls.setDraftCirclePayoutOrder += 1;
      throw new InvalidDraftCircleError("Each circle member can appear only once.");
    },
  });

  const result = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1", "m1"]), deps);
  assert.equal(result.formError, "Each circle member can appear only once.");
  assert.equal(calls.setDraftCirclePayoutOrder, 1, "the service itself is still the one that rejects it");
});

// G. exactly-once service invocation
test("setDraftCirclePayoutOrder is called exactly once for one valid submission", async () => {
  const { deps, calls } = buildDeps();
  await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1", "m2"]), deps);

  assert.equal(calls.setDraftCirclePayoutOrder, 1);
  assert.equal(calls.requireUser, 1);
});

// H. expected domain errors mapped safely
test("not-found and authorization errors collapse to the same generic message", async () => {
  const { deps: notFoundDeps } = buildDeps({
    setDraftCirclePayoutOrder: async () => {
      throw new DraftCircleMemberNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    setDraftCirclePayoutOrder: async () => {
      throw new DraftCircleMembershipAuthorizationError();
    },
  });

  const notFoundResult = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1"]), notFoundDeps);
  const authResult = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1"]), authDeps);

  assert.equal(notFoundResult.formError, "We could not find this circle.");
  assert.equal(authResult.formError, "We could not find this circle.");
});

test("a conflict (circle no longer DRAFT) maps to its own informative message -- covers a stale post-activation submission", async () => {
  const { deps } = buildDeps({
    setDraftCirclePayoutOrder: async () => {
      throw new DraftCircleMembershipConflictError();
    },
  });

  const result = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1"]), deps);
  assert.equal(result.formError, "Payout order can only be changed while the circle is still a draft.");
});

// U. stale cohort failure handled safely
test("U. a stale cohort mismatch (DraftCirclePayoutOrderError) maps to a safe, specific message", async () => {
  const { deps } = buildDeps({
    setDraftCirclePayoutOrder: async () => {
      throw new DraftCirclePayoutOrderError();
    },
  });

  const result = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1", "m2"]), deps);
  assert.equal(result.formError, "This order no longer matches the circle's current members. Please review and try again.");
});

// I. unexpected errors generic
test("an unexpected error maps to a generic fallback, never leaking the raw error text", async () => {
  const { deps } = buildDeps({
    setDraftCirclePayoutOrder: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runSetDraftCirclePayoutOrderAction(formDataFor("circle-1", ["m1"]), deps);
  assert.equal(result.formError, "We could not save the payout order. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

test("a missing circleId is rejected without calling the service", async () => {
  const { deps, calls } = buildDeps();
  const result = await runSetDraftCirclePayoutOrderAction(formDataFor("", ["m1"]), deps);

  assert.equal(result.formError, "We could not find this circle.");
  assert.equal(calls.setDraftCirclePayoutOrder, 0);
});

// Y. no member/session identity dependency, Z. no other circle-mutating service
test("this module never imports the member-session identity system or any other circle-mutating service", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./set-draft-circle-payout-order.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
    "next-auth",
    "prisma.",
    "addDraftCircleMember",
    "removeDraftCircleMember",
    "activateCircle",
    "PayoutRound",
    "ContributionObligation",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
