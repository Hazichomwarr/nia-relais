import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CircleCompletionAuthorizationError,
  CircleCompletionIntegrityError,
  CircleCompletionNotActiveError,
  CircleCompletionNotFoundError,
  CircleCompletionRoundsIncompleteError,
  PayoutAccountingIntegrityError,
  type CircleCompletionResult,
} from "@/src/services/circle-completion.service";
import {
  runCompleteCircleAction,
  type CompleteCircleDependencies,
  type TrustedOwner,
} from "@/src/actions/complete-circle";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

const FRESH_RESULT: CircleCompletionResult = {
  circleId: "circle-1",
  status: "COMPLETED",
  completedAt: "2026-01-01T00:00:00.000Z",
  completedById: "owner-1",
  replayed: false,
};

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { circleId: "circle-1", ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<CompleteCircleDependencies> = {}) {
  const calls = { requireUser: 0, completeCircle: 0 };
  let capturedInput: unknown;

  const deps: CompleteCircleDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    completeCircle: async (input) => {
      calls.completeCircle += 1;
      capturedInput = input;
      return { ...FRESH_RESULT, circleId: input.circleId };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// --- authentication ---

test("an unauthenticated caller is denied, and completeCircle is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runCompleteCircleAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.completeCircle, 0);
});

test("ownerId passed to completeCircle is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runCompleteCircleAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

test("member-session authority is never used -- no requireCircleMember/member-session reference anywhere in this module", () => {
  const source = readFileSync(new URL("./complete-circle.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /memberId/);
});

// --- input whitelist ---

test("only circleId reaches completeCircle's input -- every forged completion/lifecycle/financial field is ignored", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runCompleteCircleAction(
    validFormData({
      completedAt: "2020-01-01T00:00:00.000Z",
      completedById: "attacker-actor",
      status: "COMPLETED",
      archive: "true",
      archivedAt: "2020-01-01T00:00:00.000Z",
      archivedById: "attacker-archiver",
      roundId: "attacker-round",
      memberId: "attacker-member",
      payoutId: "attacker-payout",
      operationId: "attacker-op",
      clientOperationId: "attacker-op",
    }),
    deps,
  );

  const captured = getCapturedInput() as Record<string, unknown>;
  assert.deepEqual(Object.keys(captured).sort(), ["circleId", "ownerId"]);
});

test("a forged ownerId field cannot influence the trusted ownerId argument even when submitted alongside every other hostile field", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runCompleteCircleAction(
    validFormData({ ownerId: "attacker-owner", completedById: "attacker-owner", status: "COMPLETED" }),
    deps,
  );

  const captured = getCapturedInput() as { ownerId: string; circleId: string };
  assert.equal(captured.ownerId, "owner-1");
  assert.equal(captured.circleId, "circle-1");
});

test("an empty circleId is rejected without calling completeCircle, using the generic not-found message", async () => {
  const { deps, calls } = buildDeps();
  const result = await runCompleteCircleAction(validFormData({ circleId: "   " }), deps);

  assert.equal(calls.completeCircle, 0);
  assert.equal(result.formError, "We could not find this circle.");
});

// --- fresh success ---

test("a fresh completion succeeds with the frozen product-copy success message", async () => {
  const { deps } = buildDeps();
  const result = await runCompleteCircleAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.message, "The circle is complete.");
  assert.equal(result.formError, undefined);
});

test("the action state never exposes completedById, completedAt, or any raw service field", async () => {
  const { deps } = buildDeps();
  const result = await runCompleteCircleAction(validFormData(), deps);

  assert.deepEqual(Object.keys(result).sort(), ["message", "status"]);
});

// --- replay handling: success, never an error, never distinguished from fresh ---

test("a legitimate replay (replayed: true) surfaces as success with the SAME message as a fresh completion", async () => {
  const { deps } = buildDeps({
    completeCircle: async (input) => ({ ...FRESH_RESULT, circleId: input.circleId, replayed: true }),
  });
  const result = await runCompleteCircleAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.message, "The circle is complete.");
});

// --- error mapping ---

test("CircleCompletionNotFoundError maps to the generic not-found message", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionNotFoundError();
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this circle.");
});

test("CircleCompletionAuthorizationError maps to the SAME generic not-found message (collapsed for privacy)", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionAuthorizationError();
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this circle.");
});

test("CircleCompletionNotActiveError maps to a distinct 'cannot be completed right now' message, not the not-found message", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionNotActiveError();
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(result.formError, "This circle cannot be completed right now.");
});

test("CircleCompletionRoundsIncompleteError maps to its own distinct 'rounds must be closed' message", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionRoundsIncompleteError();
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "Every round in this circle's rotation must be closed before it can be completed.",
  );
});

test("CircleCompletionIntegrityError maps to the integrity-failure message, distinct from the rounds-incomplete message", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionIntegrityError();
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "We couldn't safely complete this circle because its saved records are inconsistent.",
  );
});

test("RoundsIncomplete and IntegrityError never collapse into the same outcome", async () => {
  const { deps: roundsIncompleteDeps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionRoundsIncompleteError();
    },
  });
  const { deps: integrityDeps } = buildDeps({
    completeCircle: async () => {
      throw new CircleCompletionIntegrityError();
    },
  });

  const roundsIncompleteResult = await runCompleteCircleAction(validFormData(), roundsIncompleteDeps);
  const integrityResult = await runCompleteCircleAction(validFormData(), integrityDeps);

  assert.notEqual(roundsIncompleteResult.formError, integrityResult.formError);
});

test("PayoutAccountingIntegrityError is treated as an integrity failure, its own internal message is never leaked", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new PayoutAccountingIntegrityError("internal ledger detail that must never reach the client");
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "We couldn't safely complete this circle because its saved records are inconsistent.",
  );
});

test("an unexpected error maps to a generic failure message and is logged, never exposed verbatim", async () => {
  const { deps } = buildDeps({
    completeCircle: async () => {
      throw new Error("some unexpected internal failure");
    },
  });
  const result = await runCompleteCircleAction(validFormData(), deps);
  assert.equal(result.formError, "We could not complete this circle. Please try again.");
});
