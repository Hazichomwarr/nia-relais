import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRIBUTION_REPLAY_CONTRACT_KEYS,
  isContributionObligationTransitionAllowed,
  isContributionPaymentTransitionAllowed,
} from "./contribution-state";

test("RECORDED may transition to CONFIRMED or REJECTED, and only those two", () => {
  assert.equal(isContributionPaymentTransitionAllowed("RECORDED", "CONFIRMED"), true);
  assert.equal(isContributionPaymentTransitionAllowed("RECORDED", "REJECTED"), true);
  assert.equal(isContributionPaymentTransitionAllowed("RECORDED", "RECORDED"), false);
});

test("CONFIRMED and REJECTED are both terminal -- no outgoing transition exists", () => {
  for (const to of ["RECORDED", "CONFIRMED", "REJECTED"] as const) {
    assert.equal(isContributionPaymentTransitionAllowed("CONFIRMED", to), false);
    assert.equal(isContributionPaymentTransitionAllowed("REJECTED", to), false);
  }
});

test("OPEN may transition to FULFILLED, and only to FULFILLED", () => {
  assert.equal(isContributionObligationTransitionAllowed("OPEN", "FULFILLED"), true);
  assert.equal(isContributionObligationTransitionAllowed("OPEN", "OPEN"), false);
});

test("FULFILLED is terminal -- no reverse transition back to OPEN", () => {
  assert.equal(isContributionObligationTransitionAllowed("FULFILLED", "OPEN"), false);
  assert.equal(isContributionObligationTransitionAllowed("FULFILLED", "FULFILLED"), false);
});

test("the documented replay contract enumerates exactly the races this ticket audited, no more and no fewer", () => {
  assert.deepEqual(CONTRIBUTION_REPLAY_CONTRACT_KEYS, [
    "duplicate-recording-operation",
    "duplicate-confirmation",
    "duplicate-rejection",
    "conflicting-terminal-decision",
    "fresh-attempt-after-rejection",
    "already-fulfilled-obligation",
  ]);
});
