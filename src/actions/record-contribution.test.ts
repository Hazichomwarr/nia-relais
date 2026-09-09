import assert from "node:assert/strict";
import test from "node:test";

import {
  ContributionAmountMismatchError,
  ContributionObligationAlreadyFulfilledError,
  ContributionObligationAlreadyRecordedError,
  ContributionObligationNotFoundError,
  ContributionOperationConflictError,
  ContributionRecordingAuthorizationError,
  ContributionRecordingCircleNotActiveError,
  ContributionRecordingCircleNotFoundError,
  ContributionRecordingConflictError,
  InvalidContributionAmountError,
} from "@/src/services/contribution-recording.service";
import {
  runRecordContributionAction,
  type RecordContributionDependencies,
  type TrustedOwner,
} from "@/src/actions/record-contribution";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    obligationId: "obligation-1",
    amount: "50.00",
    clientOperationId: "client-op-1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<RecordContributionDependencies> = {}) {
  const calls = { requireUser: 0, recordContribution: 0 };
  let capturedInput: unknown;

  const deps: RecordContributionDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    recordContribution: async (input) => {
      calls.recordContribution += 1;
      capturedInput = input;
      return {
        id: "payment-1",
        circleId: input.circleId,
        obligationId: input.input.obligationId,
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
test("an unauthenticated caller is denied, and recordContribution is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runRecordContributionAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.recordContribution, 0);
});

// trusted ownerId derivation + forged fields ignored
test("ownerId passed to recordContribution is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRecordContributionAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

test("forged memberId/roundId/currency/expectedAmount/status/actor/timestamp fields never reach the service's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRecordContributionAction(
    validFormData({
      memberId: "attacker-member",
      roundId: "attacker-round",
      currency: "XXX",
      expectedAmount: "1.00",
      status: "CONFIRMED",
      recordedById: "attacker-actor",
      recordedAt: "2020-01-01T00:00:00.000Z",
    }),
    deps,
  );

  const captured = getCapturedInput() as { input: Record<string, unknown> };
  assert.deepEqual(Object.keys(captured.input).sort(), ["amount", "clientOperationId", "obligationId"]);
});

// valid record delegation
test("a valid submission succeeds and delegates to recordContribution exactly once", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordContributionAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(calls.recordContribution, 1);
  assert.equal(calls.requireUser, 1);
});

// stable clientOperationId forwarding
test("clientOperationId is forwarded unchanged, never regenerated, across repeated submissions", async () => {
  const { deps, getCapturedInput } = buildDeps();

  await runRecordContributionAction(validFormData({ clientOperationId: "stable-op-id" }), deps);
  const first = (getCapturedInput() as { input: { clientOperationId: string } }).input.clientOperationId;

  await runRecordContributionAction(validFormData({ clientOperationId: "stable-op-id" }), deps);
  const second = (getCapturedInput() as { input: { clientOperationId: string } }).input.clientOperationId;

  assert.equal(first, "stable-op-id");
  assert.equal(second, "stable-op-id");
});

// successful replay status preserved
test("a replayed payment reports its own current status truthfully, even if since CONFIRMED", async () => {
  const { deps } = buildDeps({
    recordContribution: async (input) => ({
      id: "payment-1",
      circleId: input.circleId,
      obligationId: input.input.obligationId,
      amount: input.input.amount,
      currency: "USD",
      status: "CONFIRMED",
      clientOperationId: input.input.clientOperationId,
      recordedAt: new Date().toISOString(),
      recordedById: input.ownerId,
    }),
  });

  const result = await runRecordContributionAction(validFormData(), deps);
  assert.equal(result.status, "success");
  assert.equal(result.payment?.status, "CONFIRMED");
});

// known validation errors (field-level, before the service is called)
test("an invalid amount is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordContributionAction(validFormData({ amount: "not-a-number" }), deps);

  assert.equal(result.status, undefined);
  assert.ok(result.fieldErrors?.amount);
  assert.equal(calls.recordContribution, 0);
});

test("a missing obligationId is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordContributionAction(validFormData({ obligationId: "" }), deps);

  assert.ok(result.fieldErrors?.obligationId);
  assert.equal(calls.recordContribution, 0);
});

test("a missing circleId is rejected with a generic not-found message before validation", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRecordContributionAction(validFormData({ circleId: "" }), deps);

  assert.equal(result.formError, "We could not find this circle.");
  assert.equal(calls.recordContribution, 0);
});

// authorization/not-found collapse
test("not-found and authorization errors collapse to the same generic message", async () => {
  const { deps: notFoundDeps } = buildDeps({
    recordContribution: async () => {
      throw new ContributionRecordingCircleNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    recordContribution: async () => {
      throw new ContributionRecordingAuthorizationError();
    },
  });

  const notFoundResult = await runRecordContributionAction(validFormData(), notFoundDeps);
  const authResult = await runRecordContributionAction(validFormData(), authDeps);

  assert.equal(notFoundResult.formError, "We could not find this circle.");
  assert.equal(authResult.formError, "We could not find this circle.");
});

test("an obligation-not-found conflict states its own message plainly, once ownership is established", async () => {
  const { deps } = buildDeps({
    recordContribution: async () => {
      throw new ContributionObligationNotFoundError();
    },
  });

  const result = await runRecordContributionAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this contribution obligation.");
});

// known domain conflicts
test("known domain conflicts surface their own safe messages", async () => {
  const conflicts = [
    new ContributionRecordingCircleNotActiveError(),
    new InvalidContributionAmountError("Amount must be greater than zero."),
    new ContributionAmountMismatchError(),
    new ContributionObligationAlreadyFulfilledError(),
    new ContributionObligationAlreadyRecordedError(),
    new ContributionOperationConflictError(),
    new ContributionRecordingConflictError(),
  ];

  for (const conflict of conflicts) {
    const { deps } = buildDeps({
      recordContribution: async () => {
        throw conflict;
      },
    });
    const result = await runRecordContributionAction(validFormData(), deps);
    assert.equal(result.formError, conflict.message);
  }
});

// unexpected error safety
test("an unexpected error maps to a generic fallback, never leaking raw details", async () => {
  const { deps } = buildDeps({
    recordContribution: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runRecordContributionAction(validFormData(), deps);
  assert.equal(result.formError, "We could not record this contribution. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// no raw financial/auth data in action state
test("the success state never exposes raw Prisma models, ownerId, or clientOperationId", async () => {
  const { deps } = buildDeps();
  const result = await runRecordContributionAction(validFormData(), deps);

  assert.deepEqual(Object.keys(result.payment ?? {}).sort(), ["amount", "currency", "id", "obligationId", "status"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "ownerId"), false);
});

// no financial logic duplicated, no member-auth dependency, no schema changes
test("this module never duplicates circle locking/amount validation or imports member-session identity", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./record-contribution.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
    "next-auth",
    "prisma.",
    "lockSavingsCircleForUpdate",
    "confirmContribution",
    "rejectContribution",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
