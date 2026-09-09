import assert from "node:assert/strict";
import test from "node:test";

import {
  ContributionRejectionAmountIntegrityError,
  ContributionRejectionAuthorizationError,
  ContributionRejectionCircleNotActiveError,
  ContributionRejectionCircleNotFoundError,
  ContributionRejectionCurrencyIntegrityError,
  ContributionRejectionIntegrityConflictError,
  ContributionRejectionIntentConflictError,
  ContributionRejectionObligationNotFoundError,
  ContributionRejectionPaymentConfirmedError,
  ContributionRejectionPaymentNotFoundError,
  ContributionRejectionUnexpectedObligationStateError,
  InvalidRejectionReasonError,
} from "@/src/services/contribution-rejection.service";
import {
  runRejectContributionAction,
  type RejectContributionDependencies,
  type TrustedOwner,
} from "@/src/actions/reject-contribution";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    paymentId: "payment-1",
    rejectionReason: "Amount did not match the deposit slip.",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<RejectContributionDependencies> = {}) {
  const calls = { requireUser: 0, rejectContribution: 0 };
  let capturedInput: unknown;

  const deps: RejectContributionDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    rejectContribution: async (input) => {
      calls.rejectContribution += 1;
      capturedInput = input;
      const now = new Date().toISOString();
      return {
        id: input.input.paymentId,
        circleId: input.circleId,
        obligationId: "obligation-1",
        amount: "50.00",
        currency: "USD",
        status: "REJECTED",
        recordedAt: now,
        recordedById: "owner-1",
        rejectedAt: now,
        rejectedById: input.ownerId,
        rejectionReason: input.input.rejectionReason,
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedInput: () => capturedInput };
}

// unauthenticated denial before service invocation
test("an unauthenticated caller is denied, and rejectContribution is never called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runRejectContributionAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.rejectContribution, 0);
});

// trusted ownerId derivation + forged fields ignored
test("ownerId passed to rejectContribution is exactly requireUser's id, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRejectContributionAction(validFormData({ ownerId: "attacker-owner" }), deps);

  const captured = getCapturedInput() as { ownerId: string };
  assert.equal(captured.ownerId, "owner-1");
});

test("forged memberId/roundId/currency/expectedAmount/status/actor/timestamp fields never reach the service's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runRejectContributionAction(
    validFormData({
      memberId: "attacker-member",
      roundId: "attacker-round",
      currency: "XXX",
      expectedAmount: "1.00",
      status: "CONFIRMED",
      rejectedById: "attacker-actor",
      rejectedAt: "2020-01-01T00:00:00.000Z",
    }),
    deps,
  );

  const captured = getCapturedInput() as { input: Record<string, unknown> };
  assert.deepEqual(Object.keys(captured.input).sort(), ["paymentId", "rejectionReason"]);
});

// valid reject delegation, exactly-once
test("a valid submission succeeds and delegates to rejectContribution exactly once", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRejectContributionAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.payment?.status, "REJECTED");
  assert.equal(calls.rejectContribution, 1);
  assert.equal(calls.requireUser, 1);
});

// known validation errors
test("a missing rejection reason is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRejectContributionAction(validFormData({ rejectionReason: "" }), deps);

  assert.ok(result.fieldErrors?.rejectionReason);
  assert.equal(calls.rejectContribution, 0);
});

test("a missing paymentId is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRejectContributionAction(validFormData({ paymentId: "" }), deps);

  assert.ok(result.fieldErrors?.paymentId);
  assert.equal(calls.rejectContribution, 0);
});

test("a missing circleId is rejected with a generic not-found message before validation", async () => {
  const { deps, calls } = buildDeps();
  const result = await runRejectContributionAction(validFormData({ circleId: "" }), deps);

  assert.equal(result.formError, "We could not find this circle.");
  assert.equal(calls.rejectContribution, 0);
});

// authorization/not-found collapse
test("not-found and authorization errors collapse to the same generic message", async () => {
  const { deps: notFoundDeps } = buildDeps({
    rejectContribution: async () => {
      throw new ContributionRejectionCircleNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    rejectContribution: async () => {
      throw new ContributionRejectionAuthorizationError();
    },
  });

  const notFoundResult = await runRejectContributionAction(validFormData(), notFoundDeps);
  const authResult = await runRejectContributionAction(validFormData(), authDeps);

  assert.equal(notFoundResult.formError, "We could not find this circle.");
  assert.equal(authResult.formError, "We could not find this circle.");
});

test("a payment-not-found conflict states its own message plainly, once ownership is established", async () => {
  const { deps } = buildDeps({
    rejectContribution: async () => {
      throw new ContributionRejectionPaymentNotFoundError();
    },
  });

  const result = await runRejectContributionAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this contribution payment.");
});

// known domain conflicts
test("known domain conflicts surface their own safe messages", async () => {
  const conflicts = [
    new ContributionRejectionCircleNotActiveError(),
    new ContributionRejectionPaymentConfirmedError(),
    new ContributionRejectionObligationNotFoundError(),
    new ContributionRejectionAmountIntegrityError(),
    new ContributionRejectionCurrencyIntegrityError(),
    new ContributionRejectionUnexpectedObligationStateError(),
    new ContributionRejectionIntegrityConflictError(),
    new ContributionRejectionIntentConflictError(),
    new InvalidRejectionReasonError("Enter a rejection reason."),
  ];

  for (const conflict of conflicts) {
    const { deps } = buildDeps({
      rejectContribution: async () => {
        throw conflict;
      },
    });
    const result = await runRejectContributionAction(validFormData(), deps);
    assert.equal(result.formError, conflict.message);
  }
});

// unexpected error safety
test("an unexpected error maps to a generic fallback, never leaking raw details", async () => {
  const { deps } = buildDeps({
    rejectContribution: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runRejectContributionAction(validFormData(), deps);
  assert.equal(result.formError, "We could not reject this contribution. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// successful replay status preserved (an already-REJECTED payment stays REJECTED)
test("a legitimate exact-intent replay of an already-rejected payment reports REJECTED truthfully", async () => {
  const { deps } = buildDeps();
  const result = await runRejectContributionAction(validFormData(), deps);

  assert.equal(result.payment?.status, "REJECTED");
  assert.equal(result.payment?.rejectionReason, "Amount did not match the deposit slip.");
});

// no raw financial/auth data in action state
test("the success state never exposes raw Prisma models or ownerId", async () => {
  const { deps } = buildDeps();
  const result = await runRejectContributionAction(validFormData(), deps);

  assert.deepEqual(
    Object.keys(result.payment ?? {}).sort(),
    ["amount", "circleId", "currency", "id", "obligationId", "rejectedAt", "rejectedById", "rejectionReason", "status"],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(result, "ownerId"), false);
});

// no financial logic duplicated, no member-auth dependency, no schema changes
test("this module never duplicates circle locking/ledger checks or imports member-session identity", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./reject-contribution.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
    "next-auth",
    "prisma.",
    "lockSavingsCircleForUpdate",
    "recordContribution",
    "confirmContribution",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
