import assert from "node:assert/strict";
import test from "node:test";

import {
  CircleActivationEligibilityError,
  CircleActivationIntegrityError,
  CircleActivationStaleReviewError,
  DraftCircleMemberNotFoundError,
  DraftCircleMembershipAuthorizationError,
} from "@/src/services/circle.service";
import {
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
} from "@/src/services/circle-activation-review.service";
import {
  runActivateCircleAction,
  type ActivateCircleDependencies,
  type TrustedOwner,
} from "@/src/actions/activate-circle";

const VALID_OWNER: TrustedOwner = { id: "owner-1", name: "Fixture Owner" };

const ELIGIBLE_REVIEW = {
  circle: {
    id: "circle-1",
    name: "Fixture Circle",
    currency: "USD",
    contributionAmount: "10.00",
    frequency: "WEEKLY",
    startDate: "2026-01-01",
    status: "DRAFT" as const,
  },
  activeMemberCount: 2,
  orderedActiveMembers: [
    { id: "m1", displayName: "A", memberCode: "CODE1000000000A", payoutOrder: 1 },
    { id: "m2", displayName: "B", memberCode: "CODE2000000000B", payoutOrder: 2 },
  ],
  eligible: true,
  blockers: [],
  proposedRounds: [],
  expectedContributionPerMember: "10.00",
  expectedCollectionPerRound: "20.00",
  expectedTotalAcrossRotation: "40.00",
};

const VALID_FINGERPRINT = "m1:1|m2:2";

function formDataFor(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    circleId: "circle-1",
    confirmed: "true",
    reviewFingerprint: VALID_FINGERPRINT,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

class TestRedirectSignal extends Error {}

function buildDeps(overrides: Partial<ActivateCircleDependencies> = {}) {
  const calls = { requireUser: 0, getDraftCircleActivationReview: 0, activateCircle: 0 };
  let capturedActivateInput: unknown;

  const deps: ActivateCircleDependencies = {
    requireUser: async () => {
      calls.requireUser += 1;
      return VALID_OWNER;
    },
    getDraftCircleActivationReview: async () => {
      calls.getDraftCircleActivationReview += 1;
      return ELIGIBLE_REVIEW;
    },
    activateCircle: async (input) => {
      calls.activateCircle += 1;
      capturedActivateInput = input;
      return {
        circle: { id: input.circleId, status: "ACTIVE" as const, activatedAt: new Date().toISOString() },
        memberCount: 2,
        roundCount: 2,
        obligationCount: 4,
        rounds: [],
      };
    },
    ...overrides,
  };

  return { deps, calls, getCapturedActivateInput: () => capturedActivateInput };
}

// L. unauthenticated activation denied
test("an unauthenticated caller is denied, and neither the review nor activation is ever called", async () => {
  const { deps, calls } = buildDeps({
    requireUser: async () => {
      calls.requireUser += 1;
      throw new TestRedirectSignal();
    },
  });

  await assert.rejects(() => runActivateCircleAction(formDataFor(), deps), TestRedirectSignal);
  assert.equal(calls.getDraftCircleActivationReview, 0);
  assert.equal(calls.activateCircle, 0);
});

// A valid, confirmed, fresh submission activates.
test("a valid, confirmed, fresh submission activates the circle exactly once", async () => {
  const { deps, calls } = buildDeps();
  const outcome = await runActivateCircleAction(formDataFor(), deps);

  assert.deepEqual(outcome, { ok: true, circleId: "circle-1" });
  assert.equal(calls.activateCircle, 1);
});

// M. forged ownerId/status/terms/order/totals ignored
test("forged ownerId/status/terms/totals form fields never reach activateCircle's input -- only ownerId and circleId do", async () => {
  const { deps, getCapturedActivateInput } = buildDeps();
  await runActivateCircleAction(
    formDataFor({
      ownerId: "attacker-owner",
      status: "ACTIVE",
      expectedTotalAcrossRotation: "999999.99",
      orderedMemberIds: "forged",
    }),
    deps,
  );

  const captured = getCapturedActivateInput() as { ownerId: string; circleId: string; expectedFingerprint: string };
  assert.equal(captured.ownerId, "owner-1");
  assert.equal(captured.circleId, "circle-1");
  // expectedFingerprint IS passed through -- it is the client's own
  // submitted fingerprint (the value activateCircle's atomic guard
  // re-verifies against fresh state), not "forged data" in the sense of
  // this test: it carries no authority on its own and is meaningless
  // without activateCircle's own fresh recomputation matching it.
  assert.equal(captured.expectedFingerprint, VALID_FINGERPRINT);
});

test("a different (still matching) review/cohort produces a different fingerprint, and that exact value is what's passed through", async () => {
  const threeManReview = {
    ...ELIGIBLE_REVIEW,
    orderedActiveMembers: [
      { id: "m1", displayName: "A", memberCode: "CODE1000000000A", payoutOrder: 1 },
      { id: "m2", displayName: "B", memberCode: "CODE2000000000B", payoutOrder: 2 },
      { id: "m3", displayName: "C", memberCode: "CODE3000000000C", payoutOrder: 3 },
    ],
  };
  const threeManFingerprint = "m1:1|m2:2|m3:3";

  const { deps, getCapturedActivateInput } = buildDeps({
    getDraftCircleActivationReview: async () => threeManReview,
  });
  await runActivateCircleAction(formDataFor({ reviewFingerprint: threeManFingerprint }), deps);

  const captured = getCapturedActivateInput() as { expectedFingerprint: string };
  assert.equal(captured.expectedFingerprint, threeManFingerprint);
  assert.notEqual(captured.expectedFingerprint, VALID_FINGERPRINT);
});

// N. explicit confirmation required server-side
test("N. an unchecked confirmation is rejected server-side, without calling the review or activation", async () => {
  const { deps, calls } = buildDeps();
  const outcome = await runActivateCircleAction(formDataFor({ confirmed: "" }), deps);

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.state.formError ?? "", /confirm/i);
  assert.equal(calls.getDraftCircleActivationReview, 0);
  assert.equal(calls.activateCircle, 0);
});

test("a missing confirmed field (checkbox not submitted at all) is treated identically to unchecked", async () => {
  const data = new FormData();
  data.set("circleId", "circle-1");
  data.set("reviewFingerprint", VALID_FINGERPRINT);
  // "confirmed" is deliberately absent, matching how an unchecked
  // checkbox is never included in a real FormData submission.
  const { deps, calls } = buildDeps();

  const outcome = await runActivateCircleAction(data, deps);
  assert.equal(outcome.ok, false);
  assert.equal(calls.activateCircle, 0);
});

// O. exactly-once activation service invocation
test("O. activateCircle is called exactly once for one valid submission", async () => {
  const { deps, calls } = buildDeps();
  await runActivateCircleAction(formDataFor(), deps);

  assert.equal(calls.requireUser, 1);
  assert.equal(calls.getDraftCircleActivationReview, 1);
  assert.equal(calls.activateCircle, 1);
});

// P. expected/unexpected error mapping
test("P. not-found and authorization errors from activateCircle collapse to the same generic message", async () => {
  const { deps: notFoundDeps } = buildDeps({
    activateCircle: async () => {
      throw new DraftCircleMemberNotFoundError();
    },
  });
  const { deps: authDeps } = buildDeps({
    activateCircle: async () => {
      throw new DraftCircleMembershipAuthorizationError();
    },
  });

  const notFoundOutcome = await runActivateCircleAction(formDataFor(), notFoundDeps);
  const authOutcome = await runActivateCircleAction(formDataFor(), authDeps);

  assert.equal(!notFoundOutcome.ok && notFoundOutcome.state.formError, "We could not find this circle.");
  assert.equal(!authOutcome.ok && authOutcome.state.formError, "We could not find this circle.");
});

test("P2. an eligibility error surfaces its own safe message", async () => {
  const { deps } = buildDeps({
    activateCircle: async () => {
      throw new CircleActivationEligibilityError("At least two active members are required to activate a circle.");
    },
  });

  const outcome = await runActivateCircleAction(formDataFor(), deps);
  assert.equal(!outcome.ok && outcome.state.formError, "At least two active members are required to activate a circle.");
});

test("P3. an integrity error maps to a safe generic message, not the raw internal error", async () => {
  const { deps } = buildDeps({
    activateCircle: async () => {
      throw new CircleActivationIntegrityError();
    },
  });

  const outcome = await runActivateCircleAction(formDataFor(), deps);
  assert.equal(
    !outcome.ok && outcome.state.formError,
    "This circle's rotation could not be verified. Please refresh and try again.",
  );
});

// 7I.5.1: the atomic guard inside activateCircle itself caught a race the
// preflight check missed -- must map to the same safe stale-review
// message as the preflight's own mismatch, not a raw/different error.
test("P5. a CircleActivationStaleReviewError from activateCircle's own atomic guard maps to the same safe stale-review message", async () => {
  let activateCircleCalled = false;
  const { deps } = buildDeps({
    activateCircle: async () => {
      activateCircleCalled = true;
      throw new CircleActivationStaleReviewError();
    },
  });

  const outcome = await runActivateCircleAction(formDataFor(), deps);
  assert.equal(activateCircleCalled, true, "the atomic guard is only reachable by actually calling activateCircle");
  assert.equal(
    !outcome.ok && outcome.state.formError,
    "This circle's members or payout order changed since you last reviewed it. Please review the current configuration and try again.",
  );
});

test("P4. an unexpected error maps to a generic fallback, never leaking the raw error text", async () => {
  const { deps } = buildDeps({
    activateCircle: async () => {
      throw new Error("secret internal database connection string details");
    },
  });

  const outcome = await runActivateCircleAction(formDataFor(), deps);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.state.formError, "We could not activate this circle. Please try again.");
    assert.doesNotMatch(outcome.state.formError ?? "", /secret|database|connection/);
  }
});

// Q. stale review handled safely
test("Q. a fingerprint mismatch (stale review) stops before ever calling activateCircle", async () => {
  const { deps, calls } = buildDeps();
  const outcome = await runActivateCircleAction(formDataFor({ reviewFingerprint: "m2:1|m1:2" }), deps);

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.state.formError ?? "", /changed since you last reviewed/);
  assert.equal(calls.activateCircle, 0);
});

test("Q2. a review that is no longer eligible (e.g. a member removed since review) is rejected before activation", async () => {
  const { deps, calls } = buildDeps({
    getDraftCircleActivationReview: async () => ({ ...ELIGIBLE_REVIEW, eligible: false, blockers: ["INSUFFICIENT_MEMBERS" as const] }),
  });
  // Fingerprint still matches (same cohort/order shape), but eligibility
  // itself has changed -- must still be caught.
  const outcome = await runActivateCircleAction(formDataFor(), deps);

  assert.equal(outcome.ok, false);
  assert.equal(calls.activateCircle, 0);
});

test("a not-found/authorization/not-draft error from the review itself is mapped safely, never propagated raw", async () => {
  const { deps: notFoundDeps } = buildDeps({
    getDraftCircleActivationReview: async () => {
      throw new DraftCircleOwnerReadNotFoundError();
    },
  });
  const { deps: notDraftDeps } = buildDeps({
    getDraftCircleActivationReview: async () => {
      throw new DraftCircleOwnerReadNotDraftError();
    },
  });

  const notFoundOutcome = await runActivateCircleAction(formDataFor(), notFoundDeps);
  const notDraftOutcome = await runActivateCircleAction(formDataFor(), notDraftDeps);

  assert.equal(!notFoundOutcome.ok && notFoundOutcome.state.formError, "We could not find this circle.");
  assert.equal(!notDraftOutcome.ok && notDraftOutcome.state.formError, "This circle is no longer a draft.");
});

// R. concurrent activation/replay behavior preserved
test("R. this action never re-implements activation's own replay/idempotency logic -- it always defers to activateCircle itself", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./activate-circle.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /assertActivat/);
  assert.doesNotMatch(source, /createCircleActivationRounds/);
  assert.doesNotMatch(source, /markCircleActive/);
});

// T. no PIN/authentication-state exposure, U. no financial payment/payout mutations
test("no PIN/session field or financial-mutation reference exists in this module", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./activate-circle.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "pinHash",
    "\"pin\"",
    "nia_member_session",
    "requireCircleMember",
    "ContributionPayment",
    "Payout.create",
    "prisma.",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
