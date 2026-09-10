import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  InvalidPayoutAmountError,
  PayoutAccountingIntegrityError,
  PayoutAlreadyRecordedError,
  PayoutAmountMismatchError,
  PayoutRecordingAuthorizationError,
  PayoutRecordingCircleNotActiveError,
  PayoutRecordingCircleNotFoundError,
  PayoutRecordingConflictError,
  PayoutRecordingIntegrityConflictError,
  PayoutRecordingOperationConflictError,
  PayoutRecordingRoundNotFoundError,
} from "@/src/services/payout-recording.service";
import {
  runRecordPayoutAction,
  type RecordPayoutDependencies,
  type TrustedOwner,
} from "@/src/actions/record-payout";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    roundId: "round-1",
    amount: "50.00",
    clientOperationId: "client-op-1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<RecordPayoutDependencies> = {}) {
  const calls = { requireUser: 0, recordPayout: 0 };
  let capturedInput: unknown;

  const deps: RecordPayoutDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    recordPayout: async (input) => {
      calls.recordPayout += 1;
      capturedInput = input;
      return {
        id: "payout-1",
        circleId: input.circleId,
        roundId: input.input.roundId,
        amount: input.input.amount,
        currency: "USD",
        status: "RECORDED",
        clientOperationId: input.input.clientOperationId,
        recordedAt: new Date().toISOString(),
        recordedById: input.ownerId,
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// unauthenticated denial before service invocation
test("an unauthenticated caller is denied, and recordPayout is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runRecordPayoutAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.recordPayout, 0);
});

// trusted ownerId derivation + forged fields ignored
test("ownerId passed to recordPayout is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRecordPayoutAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

test("forged member/recipient/currency/status/actor/timestamp/round fields never reach the service's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRecordPayoutAction(
    validFormData({
      memberId: "attacker-member",
      recipientId: "attacker-recipient",
      currency: "XXX",
      status: "CONFIRMED",
      recordedById: "attacker-actor",
      confirmedByMemberId: "attacker-confirmer",
      disputedByMemberId: "attacker-disputer",
      recordedAt: "2020-01-01T00:00:00.000Z",
      confirmedAt: "2020-01-01T00:00:00.000Z",
      disputedAt: "2020-01-01T00:00:00.000Z",
      roundStatus: "ACTIVE",
      expectedPayoutAmount: "999.00",
    }),
    deps,
  );

  const captured = getCapturedInput() as { input: Record<string, unknown> };
  assert.deepEqual(Object.keys(captured.input).sort(), ["amount", "clientOperationId", "roundId"]);
});

// valid record delegation
test("a valid submission succeeds and delegates to recordPayout exactly once", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordPayoutAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(calls.recordPayout, 1);
  assert.equal(calls.requireUser, 1);
});

// stable clientOperationId forwarding
test("clientOperationId is forwarded unchanged, never regenerated, across repeated submissions", async () => {
  const { deps, getCapturedInput } = buildDeps();

  await runRecordPayoutAction(validFormData({ clientOperationId: "stable-op-id" }), deps);
  const first = (getCapturedInput() as { input: { clientOperationId: string } }).input.clientOperationId;

  await runRecordPayoutAction(validFormData({ clientOperationId: "stable-op-id" }), deps);
  const second = (getCapturedInput() as { input: { clientOperationId: string } }).input.clientOperationId;

  assert.equal(first, "stable-op-id");
  assert.equal(second, "stable-op-id");
});

// successful replay status preserved -- an important, explicitly-required case
test("a replayed payout reports its own current status truthfully, even if since CONFIRMED", async () => {
  const { deps } = buildDeps({
    recordPayout: async (input) => ({
      id: "payout-1",
      circleId: input.circleId,
      roundId: input.input.roundId,
      amount: input.input.amount,
      currency: "USD",
      status: "CONFIRMED",
      clientOperationId: input.input.clientOperationId,
      recordedAt: new Date().toISOString(),
      recordedById: input.ownerId,
    }),
  });

  const result = await runRecordPayoutAction(validFormData(), deps);
  assert.equal(result.status, "success");
  assert.equal(result.payout?.status, "CONFIRMED", "the action must never force a replay's status back to RECORDED");
});

test("a replayed payout that has since been DISPUTED is also reported truthfully", async () => {
  const { deps } = buildDeps({
    recordPayout: async (input) => ({
      id: "payout-1",
      circleId: input.circleId,
      roundId: input.input.roundId,
      amount: input.input.amount,
      currency: "USD",
      status: "DISPUTED",
      clientOperationId: input.input.clientOperationId,
      recordedAt: new Date().toISOString(),
      recordedById: input.ownerId,
    }),
  });

  const result = await runRecordPayoutAction(validFormData(), deps);
  assert.equal(result.payout?.status, "DISPUTED");
});

// known validation errors (field-level, before the service is called)
test("an invalid amount is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordPayoutAction(validFormData({ amount: "not-a-number" }), deps);

  assert.equal(result.status, undefined);
  assert.ok(result.fieldErrors?.amount);
  assert.equal(calls.recordPayout, 0);
});

test("a missing roundId is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordPayoutAction(validFormData({ roundId: "" }), deps);

  assert.ok(result.fieldErrors?.roundId);
  assert.equal(calls.recordPayout, 0);
});

test("a missing circleId is rejected with a generic not-found message before validation", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordPayoutAction(validFormData({ circleId: "" }), deps);

  assert.equal(result.formError, "We could not find this circle.");
  assert.equal(calls.recordPayout, 0);
});

// authorization/not-found collapse
test("not-found and authorization errors collapse to the same generic message", async () => {
  const { deps: notFoundDeps } = buildDeps({
    recordPayout: async () => {
      throw new PayoutRecordingCircleNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    recordPayout: async () => {
      throw new PayoutRecordingAuthorizationError();
    },
  });

  const notFoundResult = await runRecordPayoutAction(validFormData(), notFoundDeps);
  const authResult = await runRecordPayoutAction(validFormData(), authDeps);

  assert.equal(notFoundResult.formError, "We could not find this circle.");
  assert.equal(authResult.formError, "We could not find this circle.");
});

test("a round-not-found conflict states its own message plainly, once ownership is established", async () => {
  const { deps } = buildDeps({
    recordPayout: async () => {
      throw new PayoutRecordingRoundNotFoundError();
    },
  });

  const result = await runRecordPayoutAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this payout round.");
});

// known domain conflicts
test("known domain conflicts surface their own safe messages", async () => {
  const conflicts = [
    new PayoutRecordingCircleNotActiveError(),
    new InvalidPayoutAmountError("Amount must be greater than zero."),
    new PayoutAmountMismatchError(),
    new PayoutAlreadyRecordedError(),
    new PayoutRecordingOperationConflictError(),
    new PayoutRecordingIntegrityConflictError(),
    new PayoutRecordingConflictError(),
    new PayoutAccountingIntegrityError("This round's contribution obligations do not agree on a single currency."),
  ];

  for (const conflict of conflicts) {
    const { deps } = buildDeps({
      recordPayout: async () => {
        throw conflict;
      },
    });
    const result = await runRecordPayoutAction(validFormData(), deps);
    assert.equal(result.formError, conflict.message);
  }
});

// unexpected error safety
test("an unexpected error maps to a generic fallback, never leaking raw details", async () => {
  const { deps } = buildDeps({
    recordPayout: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runRecordPayoutAction(validFormData(), deps);
  assert.equal(result.formError, "We could not record this payout. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// no raw financial/auth data in action state
test("the success state never exposes raw Prisma models or ownerId", async () => {
  const { deps } = buildDeps();
  const result = await runRecordPayoutAction(validFormData(), deps);

  assert.deepEqual(
    Object.keys(result.payout ?? {}).sort(),
    ["amount", "circleId", "clientOperationId", "currency", "id", "recordedAt", "recordedById", "roundId", "status"],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(result, "ownerId"), false);
});

// no financial logic duplicated, no member-auth dependency
test("this module never duplicates circle locking/amount computation or imports member-session identity", () => {
  const source = readFileSync(new URL("./record-payout.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
    "next-auth",
    "prisma.",
    "lockSavingsCircleForUpdate",
    "confirmPayout",
    "disputePayout",
    "computeExpectedPayoutAmount",
    "ContributionObligation",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("requireUser is this action's only identity authority", () => {
  const source = readFileSync(new URL("./record-payout.ts", import.meta.url), "utf8");
  assert.match(source, /requireUser/);
  assert.doesNotMatch(source, /requireCircleMember/);
});
