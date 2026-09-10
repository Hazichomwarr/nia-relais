import assert from "node:assert/strict";
import test from "node:test";

import type { MemberPayoutsPayoutResult } from "@/src/services/payout-member-read.service";

import { canDecidePayout, getMemberPayoutStatusPresentation } from "./member-payout-display";

// Pure-function tests only -- no React rendering here (member-payout-card
// .test.ts / member-payout-controls.test.ts cover structural/source
// assertions on the components that consume these helpers).

function payout(overrides: Partial<MemberPayoutsPayoutResult> = {}): MemberPayoutsPayoutResult {
  return {
    id: "payout-1",
    amount: "75.00",
    currency: "USD",
    status: "RECORDED",
    recordedAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: null,
    disputedAt: null,
    disputeReason: null,
    ...overrides,
  };
}

// --- getMemberPayoutStatusPresentation ---

test("null (unrecorded) explains the owner records it after it happens outside NIA -- no confirm/dispute is possible yet", () => {
  const presentation = getMemberPayoutStatusPresentation(null);
  assert.equal(presentation.label, "Not yet recorded");
  assert.match(presentation.description, /no payout has been recorded yet/i);
});

test("RECORDED tells the member to confirm if received, dispute if not", () => {
  const presentation = getMemberPayoutStatusPresentation("RECORDED");
  assert.equal(presentation.label, "Awaiting your decision");
  assert.match(presentation.description, /confirm receipt/i);
  assert.match(presentation.description, /dispute/i);
});

test("CONFIRMED states plainly that the member already confirmed receiving it", () => {
  const presentation = getMemberPayoutStatusPresentation("CONFIRMED");
  assert.equal(presentation.label, "Receipt confirmed");
  assert.match(presentation.description, /you confirmed receiving this payout/i);
});

test("DISPUTED states plainly that the member reported it was not validly received -- never implies adjudication, refund, or owner retry", () => {
  const presentation = getMemberPayoutStatusPresentation("DISPUTED");
  assert.equal(presentation.label, "Receipt disputed");
  assert.match(presentation.description, /not validly received/i);
  for (const forbidden of [/adjudicat/i, /refund/i, /retry/i, /pending/i, /resolve/i, /correction/i]) {
    assert.doesNotMatch(presentation.description, forbidden);
  }
});

test("every status presentation carries a distinct badge class", () => {
  const classes = new Set(
    [null, "RECORDED", "CONFIRMED", "DISPUTED"].map(
      (status) => getMemberPayoutStatusPresentation(status as never).className,
    ),
  );
  assert.equal(classes.size, 4);
});

// --- canDecidePayout ---

test("a null payout (nothing recorded yet) offers no decision", () => {
  assert.equal(canDecidePayout(null), false);
});

test("a RECORDED payout offers a decision", () => {
  assert.equal(canDecidePayout(payout({ status: "RECORDED" })), true);
});

test("a CONFIRMED payout offers no further decision (terminal)", () => {
  assert.equal(canDecidePayout(payout({ status: "CONFIRMED" })), false);
});

test("a DISPUTED payout offers no further decision (terminal)", () => {
  assert.equal(canDecidePayout(payout({ status: "DISPUTED" })), false);
});

test("eligibility is a pure function of the payout argument alone -- it takes no round/status/due-date parameter", () => {
  assert.equal(canDecidePayout.length, 1);
});
