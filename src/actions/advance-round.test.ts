import assert from "node:assert/strict";
import test from "node:test";

import {
  PayoutAccountingIntegrityError,
  RoundLifecycleAuthorizationError,
  RoundLifecycleCircleNotActiveError,
  RoundLifecycleCircleNotFoundError,
  RoundLifecycleContributionsIncompleteError,
  RoundLifecycleIntegrityError,
  RoundLifecycleNotCurrentError,
  RoundLifecyclePayoutDisputedError,
  RoundLifecyclePayoutMissingError,
  RoundLifecyclePayoutNotConfirmedError,
  RoundLifecycleRoundNotFoundError,
  type LifecycleRoundResult,
} from "@/src/services/round-lifecycle.service";
import {
  runAdvanceRoundAction,
  type AdvanceRoundDependencies,
  type TrustedOwner,
} from "@/src/actions/advance-round";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

const CLOSED_ROUND_ONE: LifecycleRoundResult = {
  id: "round-1",
  roundNumber: 1,
  status: "CLOSED",
  activatedAt: "2026-01-01T00:00:00.000Z",
  activatedById: "owner-1",
  closedAt: "2026-01-15T00:00:00.000Z",
  closedById: "owner-1",
};

const ACTIVATED_ROUND_TWO: LifecycleRoundResult = {
  id: "round-2",
  roundNumber: 2,
  status: "ACTIVE",
  activatedAt: "2026-01-15T00:00:00.000Z",
  activatedById: "owner-1",
  closedAt: null,
  closedById: null,
};

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { circleId: "circle-1", roundId: "round-1", ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<AdvanceRoundDependencies> = {}) {
  const calls = { requireUser: 0, advanceRound: 0 };
  let capturedInput: unknown;

  const deps: AdvanceRoundDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    advanceRound: async (input) => {
      calls.advanceRound += 1;
      capturedInput = input;
      return {
        circleId: input.circleId,
        closedRound: CLOSED_ROUND_ONE,
        activatedRound: ACTIVATED_ROUND_TWO,
        isFinalRound: false,
        replayed: false,
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// --- authentication ---

test("an unauthenticated caller is denied, and advanceRound is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runAdvanceRoundAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.advanceRound, 0);
});

test("ownerId passed to advanceRound is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runAdvanceRoundAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

// --- input whitelist ---

test("only circleId and roundId reach advanceRound's input -- every forged lifecycle/financial field is ignored", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runAdvanceRoundAction(
    validFormData({
      status: "CLOSED",
      activatedAt: "2020-01-01T00:00:00.000Z",
      activatedById: "attacker-actor",
      closedAt: "2020-01-01T00:00:00.000Z",
      closedById: "attacker-closer",
      nextRoundId: "attacker-next-round",
      isFinalRound: "true",
      memberId: "attacker-member",
      recipientId: "attacker-recipient",
      payoutOrder: "1",
      startDate: "2020-01-01",
      dueDate: "2020-01-15",
    }),
    deps,
  );

  const captured = getCapturedInput() as Record<string, unknown>;
  assert.deepEqual(Object.keys(captured).sort(), ["circleId", "ownerId", "roundId"]);
});

test("an empty circleId is rejected without calling advanceRound, using the generic not-found message", async () => {
  const { deps, calls } = buildDeps();
  const result = await runAdvanceRoundAction(validFormData({ circleId: "   " }), deps);

  assert.equal(calls.advanceRound, 0);
  assert.equal(result.formError, "We could not find this circle.");
});

test("a malformed roundId is rejected with a field error, and advanceRound is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runAdvanceRoundAction(validFormData({ roundId: "not a valid id!!" }), deps);

  assert.equal(calls.advanceRound, 0);
  assert.ok(result.fieldErrors?.roundId?.length);
});

// --- fresh success: non-final advance ---

test("a fresh non-final advance succeeds with the truthful 'next round active' message", async () => {
  const { deps } = buildDeps();
  const result = await runAdvanceRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.message, "Round 2 is now active.");
  assert.deepEqual(result.closedRound, CLOSED_ROUND_ONE);
  assert.deepEqual(result.activatedRound, ACTIVATED_ROUND_TWO);
  assert.equal(result.isFinalRound, false);
});

// --- fresh success: final closure, no completion wording ---

test("a fresh final-round closure succeeds with the 'final round is closed' message, never implying circle completion", async () => {
  const { deps } = buildDeps({
    advanceRound: async (input) => ({
      circleId: input.circleId,
      closedRound: CLOSED_ROUND_ONE,
      activatedRound: null,
      isFinalRound: true,
      replayed: false,
    }),
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.message, "The final round is closed.");
  assert.equal(result.activatedRound, null);
  assert.equal(result.isFinalRound, true);

  const forbidden = ["complete", "Complete", "finished", "Finished", "SUSU completed"];
  for (const word of forbidden) {
    assert.ok(!result.message?.includes(word), `message must not contain "${word}"`);
  }
});

// --- replay handling: success, never an error ---

test("a legitimate replay of an already-closed non-final round surfaces as success with the same truthful message shape", async () => {
  const { deps } = buildDeps({
    advanceRound: async (input) => ({
      circleId: input.circleId,
      closedRound: CLOSED_ROUND_ONE,
      activatedRound: ACTIVATED_ROUND_TWO,
      isFinalRound: false,
      replayed: true,
    }),
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.formError, undefined);
  assert.equal(result.message, "Round 2 is now active.");
});

test("a legitimate replay of an already-closed final round surfaces as success, never implying completion", async () => {
  const { deps } = buildDeps({
    advanceRound: async (input) => ({
      circleId: input.circleId,
      closedRound: CLOSED_ROUND_ONE,
      activatedRound: null,
      isFinalRound: true,
      replayed: true,
    }),
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.message, "The final round is closed.");
});

// --- error mapping: identity/targeting ---

test("RoundLifecycleCircleNotFoundError maps to the generic not-found message", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleCircleNotFoundError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this circle.");
});

test("RoundLifecycleAuthorizationError maps to the SAME generic not-found message (collapsed for privacy)", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleAuthorizationError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this circle.");
});

test("RoundLifecycleRoundNotFoundError maps to a distinct, plainly-stated round-not-found message", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleRoundNotFoundError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this payout round.");
});

test("RoundLifecycleNotCurrentError maps to its own distinct message", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleNotCurrentError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "Only the circle's current round can be advanced.");
});

test("RoundLifecycleCircleNotActiveError maps to its own distinct message", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleCircleNotActiveError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "This circle is not active, so its rounds cannot be advanced right now.");
});

// --- error mapping: "not ready" business blockers, each distinct ---

test("RoundLifecycleContributionsIncompleteError uses the exact prescribed copy", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleContributionsIncompleteError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "All contributions for this round must be confirmed before it can be closed.");
});

test("RoundLifecyclePayoutMissingError uses the exact prescribed copy", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecyclePayoutMissingError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "The payout must be recorded and confirmed before this round can be closed.");
});

test("RoundLifecyclePayoutNotConfirmedError uses the exact prescribed copy", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecyclePayoutNotConfirmedError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "The recipient still needs to confirm the payout.");
});

test("RoundLifecyclePayoutDisputedError uses the exact prescribed copy and never implies it can be fixed or retried", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecyclePayoutDisputedError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "This payout was disputed, so this round cannot advance in NIA.");

  const forbidden = ["fix", "Fix", "retry", "Retry", "resolve", "Resolve", "try again"];
  for (const word of forbidden) {
    assert.ok(!result.formError?.includes(word), `message must not contain "${word}"`);
  }
});

test("all four 'not ready' business-blocker errors map to FOUR distinct messages, never collapsed into one", () => {
  const messages = new Set([
    "All contributions for this round must be confirmed before it can be closed.",
    "The payout must be recorded and confirmed before this round can be closed.",
    "The recipient still needs to confirm the payout.",
    "This payout was disputed, so this round cannot advance in NIA.",
  ]);
  assert.equal(messages.size, 4);
});

// --- error mapping: integrity failure, distinct from every "not ready" blocker ---

test("RoundLifecycleIntegrityError maps to the integrity-failure message, distinct from every business-blocker message", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new RoundLifecycleIntegrityError();
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "We couldn't safely advance this round because its saved records are inconsistent.",
  );
});

test("PayoutAccountingIntegrityError is treated as an integrity failure, its own internal message is never leaked", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new PayoutAccountingIntegrityError("internal ledger detail that must never reach the client");
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(
    result.formError,
    "We couldn't safely advance this round because its saved records are inconsistent.",
  );
});

test("an unexpected error maps to a generic failure message and is logged, never exposed verbatim", async () => {
  const { deps } = buildDeps({
    advanceRound: async () => {
      throw new Error("some unexpected internal failure");
    },
  });
  const result = await runAdvanceRoundAction(validFormData(), deps);
  assert.equal(result.formError, "We could not advance this round. Please try again.");
});
