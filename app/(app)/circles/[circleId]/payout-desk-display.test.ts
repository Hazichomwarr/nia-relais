import assert from "node:assert/strict";
import test from "node:test";

import type { OwnerPayoutsPayoutResult } from "@/src/services/payout-owner-read.service";

import { canRecordFreshPayout, getPayoutStatusPresentation } from "./payout-desk-display";

// Pure-function tests only -- no React rendering here (payout-desk.test.ts
// covers structural/source assertions on the component that consumes these
// helpers).

function payout(overrides: Partial<OwnerPayoutsPayoutResult> = {}): OwnerPayoutsPayoutResult {
  return {
    id: "payout-1",
    amount: "75.00",
    currency: "USD",
    status: "RECORDED",
    confirmationBasis: "MEMBER_CONFIRMED",
    clientOperationId: "op-1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    recordedById: "owner-1",
    confirmedAt: null,
    confirmedByMemberId: null,
    disputedAt: null,
    disputedByMemberId: null,
    disputeReason: null,
    ...overrides,
  };
}

// --- getPayoutStatusPresentation ---

test("null (unrecorded) yields the 'no payout recorded yet' meaning, never a fabricated status", () => {
  const presentation = getPayoutStatusPresentation(null);
  assert.equal(presentation.label, "Unrecorded");
  assert.equal(presentation.description, "No payout has been recorded yet.");
});

test("RECORDED yields the 'waiting for the recipient's decision' meaning", () => {
  const presentation = getPayoutStatusPresentation("RECORDED");
  assert.equal(presentation.label, "Recorded");
  assert.match(presentation.description, /waiting for the recipient's decision/i);
});

test("CONFIRMED yields the 'recipient confirmed receiving' meaning", () => {
  const presentation = getPayoutStatusPresentation("CONFIRMED");
  assert.equal(presentation.label, "Confirmed");
  assert.match(presentation.description, /confirmed receiving/i);
});

test("DISPUTED yields the 'not validly received' meaning -- never described as fixable/temporary/owner-correctable", () => {
  const presentation = getPayoutStatusPresentation("DISPUTED");
  assert.equal(presentation.label, "Disputed");
  assert.match(presentation.description, /not validly received/i);
  for (const forbidden of [/awaiting correction/i, /retry/i, /temporary/i, /owner.?fixable/i, /resend/i]) {
    assert.doesNotMatch(presentation.description, forbidden);
  }
});

test("every status presentation carries a distinct badge class -- never the same class reused across meanings", () => {
  const classes = new Set(
    [null, "RECORDED", "CONFIRMED", "DISPUTED"].map(
      (status) => getPayoutStatusPresentation(status as never).className,
    ),
  );
  assert.equal(classes.size, 4);
});

// --- 9G: imported history presentation (ticket §6) ---

test("a CONFIRMED payout with confirmationBasis IMPORTED_DECLARATION is presented as imported history, never as a recipient confirmation", () => {
  const presentation = getPayoutStatusPresentation("CONFIRMED", "IMPORTED_DECLARATION");
  assert.equal(presentation.label, "Imported history");
  assert.doesNotMatch(presentation.description, /recipient confirmed/i);
  assert.doesNotMatch(presentation.description, /NIA confirmed/i);
});

test("the imported badge class is distinct from the normal CONFIRMED (recipient-confirmed) class", () => {
  const imported = getPayoutStatusPresentation("CONFIRMED", "IMPORTED_DECLARATION");
  const normal = getPayoutStatusPresentation("CONFIRMED", "MEMBER_CONFIRMED");
  assert.notEqual(imported.className, normal.className);
});

test("a CONFIRMED payout with confirmationBasis MEMBER_CONFIRMED (or omitted) keeps the normal presentation unchanged", () => {
  const withBasis = getPayoutStatusPresentation("CONFIRMED", "MEMBER_CONFIRMED");
  const withoutBasis = getPayoutStatusPresentation("CONFIRMED");
  assert.equal(withBasis.label, "Confirmed");
  assert.equal(withoutBasis.label, "Confirmed");
});

test("RECORDED/DISPUTED/null are never reinterpreted as imported history regardless of confirmationBasis (only a CONFIRMED payout can legitimately be IMPORTED_DECLARATION)", () => {
  assert.equal(getPayoutStatusPresentation("RECORDED", "IMPORTED_DECLARATION").label, "Recorded");
  assert.equal(getPayoutStatusPresentation("DISPUTED", "IMPORTED_DECLARATION").label, "Disputed");
  assert.equal(getPayoutStatusPresentation(null, "IMPORTED_DECLARATION").label, "Unrecorded");
});

// --- canRecordFreshPayout ---

test("a null payout (unrecorded round) allows the record control", () => {
  assert.equal(canRecordFreshPayout(null), true);
});

test("a RECORDED payout hides the record control", () => {
  assert.equal(canRecordFreshPayout(payout({ status: "RECORDED" })), false);
});

test("a CONFIRMED payout hides the record control", () => {
  assert.equal(canRecordFreshPayout(payout({ status: "CONFIRMED" })), false);
});

test("a DISPUTED payout hides the record control", () => {
  assert.equal(canRecordFreshPayout(payout({ status: "DISPUTED" })), false);
});

test("eligibility is a pure function of the payout argument alone -- it takes no round/status parameter", () => {
  assert.equal(canRecordFreshPayout.length, 1);
});
