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
