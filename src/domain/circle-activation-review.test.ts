import assert from "node:assert/strict";
import test from "node:test";

import { computeActivationReviewFingerprint } from "./circle-activation-review";

test("computeActivationReviewFingerprint is deterministic for the same cohort/order", () => {
  const review = {
    orderedActiveMembers: [
      { id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 },
      { id: "m2", displayName: "B", memberCode: "CODE2", payoutOrder: 2 },
    ],
  };
  assert.equal(
    computeActivationReviewFingerprint(review),
    computeActivationReviewFingerprint(review),
  );
});

test("computeActivationReviewFingerprint changes when the payout order changes", () => {
  const before = computeActivationReviewFingerprint({
    orderedActiveMembers: [
      { id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 },
      { id: "m2", displayName: "B", memberCode: "CODE2", payoutOrder: 2 },
    ],
  });
  const afterReorder = computeActivationReviewFingerprint({
    orderedActiveMembers: [
      { id: "m2", displayName: "B", memberCode: "CODE2", payoutOrder: 1 },
      { id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 2 },
    ],
  });
  assert.notEqual(before, afterReorder);
});

test("computeActivationReviewFingerprint changes when the cohort changes", () => {
  const before = computeActivationReviewFingerprint({
    orderedActiveMembers: [{ id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 }],
  });
  const afterAdd = computeActivationReviewFingerprint({
    orderedActiveMembers: [
      { id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 },
      { id: "m2", displayName: "B", memberCode: "CODE2", payoutOrder: 2 },
    ],
  });
  assert.notEqual(before, afterAdd);
});

test("computeActivationReviewFingerprint does not depend on displayName/memberCode -- only id and payoutOrder", () => {
  const a = computeActivationReviewFingerprint({
    orderedActiveMembers: [{ id: "m1", displayName: "Original Name", memberCode: "CODE1", payoutOrder: 1 }],
  });
  const b = computeActivationReviewFingerprint({
    orderedActiveMembers: [{ id: "m1", displayName: "Renamed", memberCode: "CODE1", payoutOrder: 1 }],
  });
  assert.equal(a, b);
});

test("computeActivationReviewFingerprint changes when an editable circle term changes", () => {
  const orderedActiveMembers = [{ id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 }];
  const before = computeActivationReviewFingerprint({ orderedActiveMembers, circle: { id: "c1", name: "Circle", currency: "USD", contributionAmount: "10.00", frequency: "WEEKLY", startDate: "2099-01-01", status: "DRAFT" } });
  const after = computeActivationReviewFingerprint({ orderedActiveMembers, circle: { id: "c1", name: "Circle", currency: "EUR", contributionAmount: "10.00", frequency: "WEEKLY", startDate: "2099-01-01", status: "DRAFT" } });
  assert.notEqual(before, after);
});

// 9D.1 (docs/product/susu-existing-import-contract-freeze.md §11): a
// change to originKind or K between review and activation submission must
// invalidate a previously reviewed activation state exactly like any other
// term change already does above.
test("computeActivationReviewFingerprint changes when historicalCompletedRoundCount (K) changes", () => {
  const orderedActiveMembers = [{ id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 }];
  const baseCircle = { id: "c1", name: "Circle", currency: "USD", contributionAmount: "10.00", frequency: "WEEKLY", startDate: "2099-01-01", status: "DRAFT" as const, originKind: "IMPORTED" as const };
  const before = computeActivationReviewFingerprint({ orderedActiveMembers, circle: { ...baseCircle, historicalCompletedRoundCount: 3 } });
  const after = computeActivationReviewFingerprint({ orderedActiveMembers, circle: { ...baseCircle, historicalCompletedRoundCount: 4 } });
  assert.notEqual(before, after);
});

test("computeActivationReviewFingerprint changes when originKind changes", () => {
  const orderedActiveMembers = [{ id: "m1", displayName: "A", memberCode: "CODE1", payoutOrder: 1 }];
  const baseCircle = { id: "c1", name: "Circle", currency: "USD", contributionAmount: "10.00", frequency: "WEEKLY", startDate: "2099-01-01", status: "DRAFT" as const, historicalCompletedRoundCount: 0 };
  const asNew = computeActivationReviewFingerprint({ orderedActiveMembers, circle: { ...baseCircle, originKind: "NEW" as const } });
  const asImported = computeActivationReviewFingerprint({ orderedActiveMembers, circle: { ...baseCircle, originKind: "IMPORTED" as const } });
  assert.notEqual(asNew, asImported);
});
