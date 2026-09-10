import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PayoutAccountingIntegrityError,
  PayoutConfirmationAccountingIntegrityError,
  PayoutConfirmationCircleNotActiveError,
  PayoutConfirmationDisputedError,
  PayoutConfirmationNotFoundError,
  PayoutConfirmationProvenanceIntegrityError,
  PayoutConfirmationReplayIntegrityError,
  PayoutConfirmationUnauthorizedError,
} from "@/src/services/payout-confirmation.service";
import {
  runConfirmPayoutAction,
  type ConfirmPayoutDependencies,
  type TrustedMember,
} from "@/src/actions/confirm-payout";

const VALID_MEMBER: TrustedMember = { circleId: "circle-1", memberId: "member-1" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    payoutId: "payout-1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<ConfirmPayoutDependencies> = {}) {
  const calls = { requireCircleMember: 0, confirmPayout: 0 };
  const requireCircleMemberArgs: string[] = [];
  let capturedInput: unknown;

  const deps: ConfirmPayoutDependencies = {
    requireCircleMember: async (circleId) => {
      calls.requireCircleMember += 1;
      requireCircleMemberArgs.push(circleId);
      return VALID_MEMBER;
    },
    confirmPayout: async (input) => {
      calls.confirmPayout += 1;
      capturedInput = input;
      const now = new Date().toISOString();
      return {
        id: input.input.payoutId,
        circleId: input.circleId,
        roundId: "round-1",
        amount: "75.00",
        currency: "USD",
        status: "CONFIRMED",
        recordedAt: now,
        recordedById: "owner-1",
        confirmedAt: now,
        confirmedByMemberId: input.memberId,
      };
    },
    ...overrides,
  };

  return { deps, calls, requireCircleMemberArgs, getCapturedInput: () => capturedInput };
}

// unauthenticated denial before service invocation
test("a rejected member session is denied, and confirmPayout is never called", async () => {
  const { deps, calls } = buildDeps({
    requireCircleMember: async () => {
      calls.requireCircleMember += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runConfirmPayoutAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.confirmPayout, 0);
});

// circleId is handed to requireCircleMember unconditionally, from the form
test("requireCircleMember is called with the form's circleId", async () => {
  const { deps, requireCircleMemberArgs } = buildDeps();
  await runConfirmPayoutAction(validFormData({ circleId: "circle-9" }), deps);

  assert.deepEqual(requireCircleMemberArgs, ["circle-9"]);
});

// trusted memberId derivation + forged fields ignored
test("circleId/memberId passed to confirmPayout come exactly from requireCircleMember's identity, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps({
    requireCircleMember: async () => ({ circleId: "trusted-circle", memberId: "trusted-member" }),
  });
  await runConfirmPayoutAction(validFormData({ memberId: "attacker-member", recipientId: "attacker-recipient" }), deps);

  const captured = getCapturedInput() as { circleId: string; memberId: string };
  assert.equal(captured.circleId, "trusted-circle");
  assert.equal(captured.memberId, "trusted-member");
});

test("forged member/recipient/currency/status/actor/timestamp/round fields never reach the service's input", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runConfirmPayoutAction(
    validFormData({
      memberId: "attacker-member",
      recipientId: "attacker-recipient",
      roundId: "attacker-round",
      currency: "XXX",
      status: "DISPUTED",
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
  assert.deepEqual(Object.keys(captured.input).sort(), ["payoutId"]);
});

// valid confirm delegation, exactly-once
test("a valid submission succeeds and delegates to confirmPayout exactly once", async () => {
  const { deps, calls } = buildDeps();
  const result = await runConfirmPayoutAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.payout?.status, "CONFIRMED");
  assert.equal(calls.confirmPayout, 1);
  assert.equal(calls.requireCircleMember, 1);
});

// successful replay treated as success -- an already-CONFIRMED payout stays CONFIRMED
test("a legitimate replay of an already-confirmed payout reports CONFIRMED as success, not an error", async () => {
  const { deps } = buildDeps();
  const result = await runConfirmPayoutAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.payout?.status, "CONFIRMED");
});

// known validation errors (field-level, before the service is called)
test("a missing payoutId is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runConfirmPayoutAction(validFormData({ payoutId: "" }), deps);

  assert.ok(result.fieldErrors?.payoutId);
  assert.equal(calls.confirmPayout, 0);
});

// domain errors
test("a not-found payout states its own safe message", async () => {
  const { deps } = buildDeps({
    confirmPayout: async () => {
      throw new PayoutConfirmationNotFoundError();
    },
  });

  const result = await runConfirmPayoutAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this payout.");
});

test("a non-recipient is mapped to its own safe unauthorized message", async () => {
  const { deps } = buildDeps({
    confirmPayout: async () => {
      throw new PayoutConfirmationUnauthorizedError();
    },
  });

  const result = await runConfirmPayoutAction(validFormData(), deps);
  assert.equal(result.formError, new PayoutConfirmationUnauthorizedError().message);
});

test("an already-DISPUTED terminal conflict is mapped safely", async () => {
  const { deps } = buildDeps({
    confirmPayout: async () => {
      throw new PayoutConfirmationDisputedError();
    },
  });

  const result = await runConfirmPayoutAction(validFormData(), deps);
  assert.equal(result.formError, new PayoutConfirmationDisputedError().message);
});

test("known domain conflicts surface their own safe messages", async () => {
  const conflicts = [
    new PayoutConfirmationCircleNotActiveError(),
    new PayoutConfirmationAccountingIntegrityError(),
    new PayoutConfirmationProvenanceIntegrityError(),
    new PayoutConfirmationReplayIntegrityError(),
    new PayoutAccountingIntegrityError("This round's contribution obligations do not agree on a single currency."),
  ];

  for (const conflict of conflicts) {
    const { deps } = buildDeps({
      confirmPayout: async () => {
        throw conflict;
      },
    });
    const result = await runConfirmPayoutAction(validFormData(), deps);
    assert.equal(result.formError, conflict.message);
  }
});

// unexpected error safety
test("an unexpected error maps to a generic fallback, never leaking raw details", async () => {
  const { deps } = buildDeps({
    confirmPayout: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runConfirmPayoutAction(validFormData(), deps);
  assert.equal(result.formError, "We could not confirm this payout. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// no raw financial/auth data in action state
test("the success state never exposes raw Prisma models or memberId", async () => {
  const { deps } = buildDeps();
  const result = await runConfirmPayoutAction(validFormData(), deps);

  assert.deepEqual(
    Object.keys(result.payout ?? {}).sort(),
    ["amount", "circleId", "confirmedAt", "confirmedByMemberId", "currency", "id", "recordedAt", "recordedById", "roundId", "status"],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(result, "memberId"), false);
});

// no financial logic duplicated, no owner-auth dependency (checked on the
// CODE only -- comments are stripped first, since this file's own prose
// legitimately explains the requireUser/requireCircleMember boundary by
// naming both)
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("this module never duplicates circle locking/recipient-authority checks or imports platform-User identity", () => {
  const source = stripComments(readFileSync(new URL("./confirm-payout.ts", import.meta.url), "utf8"));
  for (const forbidden of [
    "requireUser",
    "next-auth",
    "prisma.",
    "lockSavingsCircleForUpdate",
    "recordPayout",
    "disputePayout",
    "computeExpectedPayoutAmount",
    "ContributionObligation",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("requireCircleMember is this action's only identity authority", () => {
  const source = stripComments(readFileSync(new URL("./confirm-payout.ts", import.meta.url), "utf8"));
  assert.match(source, /requireCircleMember/);
  assert.doesNotMatch(source, /requireUser/);
});
