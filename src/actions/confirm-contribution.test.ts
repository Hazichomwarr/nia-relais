import assert from "node:assert/strict";
import test from "node:test";

import {
  ContributionConfirmationAmountIntegrityError,
  ContributionConfirmationAuthorizationError,
  ContributionConfirmationCircleNotActiveError,
  ContributionConfirmationCircleNotFoundError,
  ContributionConfirmationCurrencyIntegrityError,
  ContributionConfirmationIntegrityConflictError,
  ContributionConfirmationObligationNotFoundError,
  ContributionConfirmationPaymentNotFoundError,
  ContributionConfirmationPaymentRejectedError,
  ContributionConfirmationUnexpectedObligationStateError,
} from "@/src/services/contribution-confirmation.service";
import {
  runConfirmContributionAction,
  type ConfirmContributionDependencies,
  type TrustedOwner,
} from "@/src/actions/confirm-contribution";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    paymentId: "payment-1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<ConfirmContributionDependencies> = {}) {
  const calls = { requireUser: 0, confirmContribution: 0 };
  let capturedInput: unknown;

  const deps: ConfirmContributionDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    confirmContribution: async (input) => {
      calls.confirmContribution += 1;
      capturedInput = input;
      const now = new Date().toISOString();
      return {
        payment: {
          id: input.input.paymentId,
          circleId: input.circleId,
          obligationId: "obligation-1",
          amount: "50.00",
          currency: "USD",
          status: "CONFIRMED",
          recordedAt: now,
          recordedById: "owner-1",
          confirmedAt: now,
          confirmedById: input.ownerId,
        },
        obligation: { id: "obligation-1", status: "FULFILLED", fulfilledAt: now },
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// unauthenticated denial before service invocation
test("an unauthenticated caller is denied, and confirmContribution is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runConfirmContributionAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.confirmContribution, 0);
});

// trusted ownerId derivation + forged fields ignored
test("ownerId passed to confirmContribution is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runConfirmContributionAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

test("forged memberId/roundId/currency/expectedAmount/status/actor/timestamp fields never reach the service's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runConfirmContributionAction(
    validFormData({
      memberId: "attacker-member",
      roundId: "attacker-round",
      currency: "XXX",
      expectedAmount: "1.00",
      status: "REJECTED",
      confirmedById: "attacker-actor",
      confirmedAt: "2020-01-01T00:00:00.000Z",
    }),
    deps,
  );

  const captured = getCapturedInput() as { input: Record<string, unknown> };
  assert.deepEqual(Object.keys(captured.input).sort(), ["paymentId"]);
});

// valid confirm delegation, exactly-once
test("a valid submission succeeds and delegates to confirmContribution exactly once", async () => {
  const { deps, calls } = buildDeps();
  const result = await runConfirmContributionAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.payment?.status, "CONFIRMED");
  assert.equal(result.obligation?.status, "FULFILLED");
  assert.equal(calls.confirmContribution, 1);
  assert.equal(calls.requireUser, 1);
});

// known validation errors
test("a missing paymentId is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runConfirmContributionAction(validFormData({ paymentId: "" }), deps);

  assert.ok(result.fieldErrors?.paymentId);
  assert.equal(calls.confirmContribution, 0);
});

test("a missing circleId is rejected with a generic not-found message before validation", async () => {
  const { deps, calls } = buildDeps();
  const result = await runConfirmContributionAction(validFormData({ circleId: "" }), deps);

  assert.equal(result.formError, "We could not find this circle.");
  assert.equal(calls.confirmContribution, 0);
});

// authorization/not-found collapse
test("not-found and authorization errors collapse to the same generic message", async () => {
  const { deps: notFoundDeps } = buildDeps({
    confirmContribution: async () => {
      throw new ContributionConfirmationCircleNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    confirmContribution: async () => {
      throw new ContributionConfirmationAuthorizationError();
    },
  });

  const notFoundResult = await runConfirmContributionAction(validFormData(), notFoundDeps);
  const authResult = await runConfirmContributionAction(validFormData(), authDeps);

  assert.equal(notFoundResult.formError, "We could not find this circle.");
  assert.equal(authResult.formError, "We could not find this circle.");
});

test("a payment-not-found conflict states its own message plainly, once ownership is established", async () => {
  const { deps } = buildDeps({
    confirmContribution: async () => {
      throw new ContributionConfirmationPaymentNotFoundError();
    },
  });

  const result = await runConfirmContributionAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this contribution payment.");
});

// known domain conflicts
test("known domain conflicts surface their own safe messages", async () => {
  const conflicts = [
    new ContributionConfirmationCircleNotActiveError(),
    new ContributionConfirmationPaymentRejectedError(),
    new ContributionConfirmationObligationNotFoundError(),
    new ContributionConfirmationAmountIntegrityError(),
    new ContributionConfirmationCurrencyIntegrityError(),
    new ContributionConfirmationUnexpectedObligationStateError(),
    new ContributionConfirmationIntegrityConflictError(),
  ];

  for (const conflict of conflicts) {
    const { deps } = buildDeps({
      confirmContribution: async () => {
        throw conflict;
      },
    });
    const result = await runConfirmContributionAction(validFormData(), deps);
    assert.equal(result.formError, conflict.message);
  }
});

// unexpected error safety
test("an unexpected error maps to a generic fallback, never leaking raw details", async () => {
  const { deps } = buildDeps({
    confirmContribution: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runConfirmContributionAction(validFormData(), deps);
  assert.equal(result.formError, "We could not confirm this contribution. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// successful replay status preserved (an already-CONFIRMED payment stays CONFIRMED)
test("a legitimate replay of an already-confirmed payment reports CONFIRMED/FULFILLED truthfully", async () => {
  const { deps } = buildDeps();
  const result = await runConfirmContributionAction(validFormData(), deps);

  assert.equal(result.payment?.status, "CONFIRMED");
  assert.equal(result.obligation?.status, "FULFILLED");
});

// no raw financial/auth data in action state
test("the success state never exposes raw Prisma models or ownerId", async () => {
  const { deps } = buildDeps();
  const result = await runConfirmContributionAction(validFormData(), deps);

  assert.deepEqual(
    Object.keys(result.payment ?? {}).sort(),
    ["amount", "circleId", "confirmedAt", "confirmedById", "currency", "id", "obligationId", "status"],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(result, "ownerId"), false);
});

// no financial logic duplicated, no member-auth dependency, no schema changes
test("this module never duplicates circle locking/ledger checks or imports member-session identity", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./confirm-contribution.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
    "next-auth",
    "prisma.",
    "lockSavingsCircleForUpdate",
    "recordContribution",
    "rejectContribution",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
