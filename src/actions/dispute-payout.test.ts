import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  InvalidDisputeReasonError,
  PayoutAccountingIntegrityError,
  PayoutDisputeAccountingIntegrityError,
  PayoutDisputeCircleNotActiveError,
  PayoutDisputeConfirmedError,
  PayoutDisputeIntentConflictError,
  PayoutDisputeNotFoundError,
  PayoutDisputeProvenanceIntegrityError,
  PayoutDisputeReplayIntegrityError,
  PayoutDisputeUnauthorizedError,
} from "@/src/services/payout-dispute.service";
import {
  runDisputePayoutAction,
  type DisputePayoutDependencies,
  type TrustedMember,
} from "@/src/actions/dispute-payout";

const VALID_MEMBER: TrustedMember = { circleId: "circle-1", memberId: "member-1" };

function validFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    payoutId: "payout-1",
    disputeReason: "Never received the funds.",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<DisputePayoutDependencies> = {}) {
  const calls = { requireCircleMember: 0, disputePayout: 0 };
  const requireCircleMemberArgs: string[] = [];
  let capturedInput: unknown;

  const deps: DisputePayoutDependencies = {
    requireCircleMember: async (circleId) => {
      calls.requireCircleMember += 1;
      requireCircleMemberArgs.push(circleId);
      return VALID_MEMBER;
    },
    disputePayout: async (input) => {
      calls.disputePayout += 1;
      capturedInput = input;
      const now = new Date().toISOString();
      return {
        id: input.input.payoutId,
        circleId: input.circleId,
        roundId: "round-1",
        amount: "75.00",
        currency: "USD",
        status: "DISPUTED",
        recordedAt: now,
        recordedById: "owner-1",
        disputedAt: now,
        disputedByMemberId: input.memberId,
        disputeReason: input.input.disputeReason,
      };
    },
    ...overrides,
  };

  return { deps, calls, requireCircleMemberArgs, getCapturedInput: () => capturedInput };
}

// unauthenticated denial before service invocation
test("a rejected member session is denied, and disputePayout is never called", async () => {
  const { deps, calls } = buildDeps({
    requireCircleMember: async () => {
      calls.requireCircleMember += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runDisputePayoutAction(validFormData(), deps), TestRedirectSignal);
  assert.equal(calls.disputePayout, 0);
});

test("requireCircleMember is called with the form's circleId", async () => {
  const { deps, requireCircleMemberArgs } = buildDeps();
  await runDisputePayoutAction(validFormData({ circleId: "circle-9" }), deps);

  assert.deepEqual(requireCircleMemberArgs, ["circle-9"]);
});

// trusted memberId derivation + forged fields ignored
test("circleId/memberId passed to disputePayout come exactly from requireCircleMember's identity, never from the form", async () => {
  const { deps, getCapturedInput } = buildDeps({
    requireCircleMember: async () => ({ circleId: "trusted-circle", memberId: "trusted-member" }),
  });
  await runDisputePayoutAction(validFormData({ memberId: "attacker-member", recipientId: "attacker-recipient" }), deps);

  const captured = getCapturedInput() as { circleId: string; memberId: string };
  assert.equal(captured.circleId, "trusted-circle");
  assert.equal(captured.memberId, "trusted-member");
});

test("only payoutId and disputeReason reach the service's input -- forged actor/member/recipient fields never do", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runDisputePayoutAction(
    validFormData({
      memberId: "attacker-member",
      recipientId: "attacker-recipient",
      roundId: "attacker-round",
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
  assert.deepEqual(Object.keys(captured.input).sort(), ["disputeReason", "payoutId"]);
});

test("the normalized disputeReason is forwarded exactly as the schema produces it", async () => {
  const { deps, getCapturedInput } = buildDeps();
  await runDisputePayoutAction(validFormData({ disputeReason: "  Padded reason.  " }), deps);

  const captured = getCapturedInput() as { input: { disputeReason: string } };
  assert.equal(captured.input.disputeReason, "Padded reason.");
});

// valid dispute delegation, exactly-once
test("a valid submission succeeds and delegates to disputePayout exactly once", async () => {
  const { deps, calls } = buildDeps();
  const result = await runDisputePayoutAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.payout?.status, "DISPUTED");
  assert.equal(calls.disputePayout, 1);
  assert.equal(calls.requireCircleMember, 1);
});

// successful exact-reason replay treated as success
test("a legitimate exact-reason replay of an already-disputed payout reports DISPUTED as success", async () => {
  const { deps } = buildDeps();
  const result = await runDisputePayoutAction(validFormData(), deps);

  assert.equal(result.status, "success");
  assert.equal(result.payout?.status, "DISPUTED");
  assert.equal(result.payout?.disputeReason, "Never received the funds.");
});

// known validation errors (field-level, before the service is called)
test("a missing payoutId is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runDisputePayoutAction(validFormData({ payoutId: "" }), deps);

  assert.ok(result.fieldErrors?.payoutId);
  assert.equal(calls.disputePayout, 0);
});

test("an empty disputeReason is rejected with a field error, and the service is never called", async () => {
  const { deps, calls } = buildDeps();
  const result = await runDisputePayoutAction(validFormData({ disputeReason: "" }), deps);

  assert.ok(result.fieldErrors?.disputeReason);
  assert.equal(calls.disputePayout, 0);
});

test("a whitespace-only disputeReason is rejected with a field error", async () => {
  const { deps, calls } = buildDeps();
  const result = await runDisputePayoutAction(validFormData({ disputeReason: "    " }), deps);

  assert.ok(result.fieldErrors?.disputeReason);
  assert.equal(calls.disputePayout, 0);
});

test("an excessively long disputeReason is rejected by the schema boundary", async () => {
  const { deps, calls } = buildDeps();
  const result = await runDisputePayoutAction(validFormData({ disputeReason: "x".repeat(501) }), deps);

  assert.ok(result.fieldErrors?.disputeReason);
  assert.equal(calls.disputePayout, 0);
});

// domain errors
test("a not-found payout states its own safe message", async () => {
  const { deps } = buildDeps({
    disputePayout: async () => {
      throw new PayoutDisputeNotFoundError();
    },
  });

  const result = await runDisputePayoutAction(validFormData(), deps);
  assert.equal(result.formError, "We could not find this payout.");
});

test("a non-recipient is mapped to its own safe unauthorized message", async () => {
  const { deps } = buildDeps({
    disputePayout: async () => {
      throw new PayoutDisputeUnauthorizedError();
    },
  });

  const result = await runDisputePayoutAction(validFormData(), deps);
  assert.equal(result.formError, new PayoutDisputeUnauthorizedError().message);
});

test("a mismatched-reason replay is mapped safely as an intent conflict", async () => {
  const { deps } = buildDeps({
    disputePayout: async () => {
      throw new PayoutDisputeIntentConflictError();
    },
  });

  const result = await runDisputePayoutAction(validFormData(), deps);
  assert.equal(result.formError, new PayoutDisputeIntentConflictError().message);
});

test("an already-CONFIRMED terminal conflict is mapped safely", async () => {
  const { deps } = buildDeps({
    disputePayout: async () => {
      throw new PayoutDisputeConfirmedError();
    },
  });

  const result = await runDisputePayoutAction(validFormData(), deps);
  assert.equal(result.formError, new PayoutDisputeConfirmedError().message);
});

test("known domain conflicts surface their own safe messages", async () => {
  const conflicts = [
    new PayoutDisputeCircleNotActiveError(),
    new InvalidDisputeReasonError("Enter a dispute reason."),
    new PayoutDisputeAccountingIntegrityError(),
    new PayoutDisputeProvenanceIntegrityError(),
    new PayoutDisputeReplayIntegrityError(),
    new PayoutAccountingIntegrityError("This round's contribution obligations do not agree on a single currency."),
  ];

  for (const conflict of conflicts) {
    const { deps } = buildDeps({
      disputePayout: async () => {
        throw conflict;
      },
    });
    const result = await runDisputePayoutAction(validFormData(), deps);
    assert.equal(result.formError, conflict.message);
  }
});

// unexpected error safety
test("an unexpected error maps to a generic fallback, never leaking raw details", async () => {
  const { deps } = buildDeps({
    disputePayout: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const result = await runDisputePayoutAction(validFormData(), deps);
  assert.equal(result.formError, "We could not record this dispute. Please try again.");
  assert.doesNotMatch(result.formError ?? "", /secret|database|connection/);
});

// no raw financial/auth data in action state
test("the success state never exposes raw Prisma models or memberId", async () => {
  const { deps } = buildDeps();
  const result = await runDisputePayoutAction(validFormData(), deps);

  assert.deepEqual(
    Object.keys(result.payout ?? {}).sort(),
    [
      "amount",
      "circleId",
      "currency",
      "disputeReason",
      "disputedAt",
      "disputedByMemberId",
      "id",
      "recordedAt",
      "recordedById",
      "roundId",
      "status",
    ],
  );
  assert.equal(Object.prototype.hasOwnProperty.call(result, "memberId"), false);
});

// no dispute adjudication/interpretation, no owner-auth dependency
// (checked on the CODE only -- comments are stripped first, since this
// file's own prose legitimately explains the requireUser/
// requireCircleMember boundary by naming both)
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("this module never duplicates circle locking/recipient-authority checks, imports platform-User identity, or interprets the reason", () => {
  const source = stripComments(readFileSync(new URL("./dispute-payout.ts", import.meta.url), "utf8"));
  for (const forbidden of [
    "requireUser",
    "next-auth",
    "prisma.",
    "lockSavingsCircleForUpdate",
    "recordPayout",
    "confirmPayout",
    "computeExpectedPayoutAmount",
    "ContributionObligation",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("requireCircleMember is this action's only identity authority", () => {
  const source = stripComments(readFileSync(new URL("./dispute-payout.ts", import.meta.url), "utf8"));
  assert.match(source, /requireCircleMember/);
  assert.doesNotMatch(source, /requireUser/);
});
