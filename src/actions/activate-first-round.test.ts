import assert from "node:assert/strict";
import test from "node:test";

import {
  PayoutAccountingIntegrityError,
  RoundLifecycleAuthorizationError,
  RoundLifecycleCircleNotActiveError,
  RoundLifecycleCircleNotFoundError,
  RoundLifecycleIntegrityError,
  type LifecycleRoundResult,
} from "@/src/services/round-lifecycle.service";
import {
  runActivateFirstRoundAction,
  type ActivateFirstRoundDependencies,
  type TrustedOwner,
} from "@/src/actions/activate-first-round";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

const ROUND_ONE: LifecycleRoundResult = {
  id: "round-1",
  roundNumber: 1,
  status: "ACTIVE",
  activatedAt: "2026-01-01T00:00:00.000Z",
  activatedById: "owner-1",
  closedAt: null,
  closedById: null,
};

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { circleId: "circle-1", ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<ActivateFirstRoundDependencies> = {}) {
  const calls = { requireUser: 0, activateFirstRound: 0 };
  let capturedInput: unknown;

  const deps: ActivateFirstRoundDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    activateFirstRound: async (input) => {
      calls.activateFirstRound += 1;
      capturedInput = input;
      return { circleId: input.circleId, round: ROUND_ONE, replayed: false };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// --- authentication ---

test("an unauthenticated caller is denied, and activateFirstRound is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runActivateFirstRoundAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.activateFirstRound, 0);
});

test("ownerId passed to activateFirstRound is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runActivateFirstRoundAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

// --- input whitelist ---

test("only circleId reaches activateFirstRound's input -- every forged lifecycle/financial field is ignored", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runActivateFirstRoundAction(
    validFormData({
      roundId: "attacker-round",
      status: "ACTIVE",
      activatedAt: "2020-01-01T00:00:00.000Z",
      activatedById: "attacker-actor",
      closedAt: "2020-01-01T00:00:00.000Z",
      closedById: "attacker-closer",
      memberId: "attacker-member",
      recipientId: "attacker-recipient",
      payoutOrder: "1",
      startDate: "2020-01-01",
      dueDate: "2020-01-15",
    }),
    deps,
  );

  const captured = getCapturedInput() as Record<string, unknown>;
  assert.deepEqual(Object.keys(captured).sort(), ["circleId", "ownerId"]);
});

test("an empty circleId is rejected without calling activateFirstRound, using the generic not-found message", async () => {
  const { deps, calls } = buildDeps();
  const result = await runActivateFirstRoundAction(validFormData({ circleId: "   " }), deps);

  assert.equal(calls.activateFirstRound, 0);
  assert.equal(result.formError, "We could not find this circle.");
});

// --- fresh success ---

test("a fresh activation succeeds with a truthful, round-derived message", async () => {
  const { deps } = buildDeps();
  const result = await runActivateFirstRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.message, "Round 1 is active.");
  assert.deepEqual(result.round, ROUND_ONE);
});

// --- replay handling: success, never an error ---

test("a legitimate replay (replayed: true) surfaces as success, never as an error", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async (input) => ({ circleId: input.circleId, round: ROUND_ONE, replayed: true }),
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.formError, undefined);
  assert.deepEqual(result.round, ROUND_ONE);
});

test("a replay where round 1 has since progressed to CLOSED still surfaces as success, reporting the true CLOSED status", async () => {
  const closedRoundOne: LifecycleRoundResult = { ...ROUND_ONE, status: "CLOSED", closedAt: "2026-02-01T00:00:00.000Z", closedById: "owner-1" };
  const { deps } = buildDeps({
    activateFirstRound: async (input) => ({ circleId: input.circleId, round: closedRoundOne, replayed: true }),
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.round?.status, "CLOSED");
});

// --- error mapping ---

test("RoundLifecycleCircleNotFoundError maps to the generic not-found message", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async () => {
      throw new RoundLifecycleCircleNotFoundError();
    },
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this circle.");
});

test("RoundLifecycleAuthorizationError maps to the SAME generic not-found message (collapsed for privacy)", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async () => {
      throw new RoundLifecycleAuthorizationError();
    },
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this circle.");
});

test("RoundLifecycleCircleNotActiveError maps to a distinct 'cannot start now' message, not the not-found message", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async () => {
      throw new RoundLifecycleCircleNotActiveError();
    },
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);
  assert.equal(result.formError, "This circle cannot start its rounds right now.");
});

test("RoundLifecycleIntegrityError maps to the integrity-failure message, distinct from the not-active message", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async () => {
      throw new RoundLifecycleIntegrityError();
    },
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "We couldn't safely start this round because its saved records are inconsistent.",
  );
});

test("PayoutAccountingIntegrityError is treated as an integrity failure, its own internal message is never leaked", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async () => {
      throw new PayoutAccountingIntegrityError("internal ledger detail that must never reach the client");
    },
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "We couldn't safely start this round because its saved records are inconsistent.",
  );
});

test("an unexpected error maps to a generic failure message and is logged, never exposed verbatim", async () => {
  const { deps } = buildDeps({
    activateFirstRound: async () => {
      throw new Error("some unexpected internal failure");
    },
  });
  const result = await runActivateFirstRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not start this round. Please try again.");
});
