import assert from "node:assert/strict";
import test from "node:test";

import { getAdvanceCtaLabel, getBlockerMessage } from "./round-lifecycle-display";

// Genuine pure-function unit tests -- these actually invoke the exported
// functions (not source-regex inspection), since this module has no
// React/framework dependency at all.

test("getBlockerMessage: CONTRIBUTIONS_INCOMPLETE uses the exact prescribed copy", () => {
  assert.equal(
    getBlockerMessage("CONTRIBUTIONS_INCOMPLETE"),
    "All contributions for this round must be confirmed before it can be closed.",
  );
});

test("getBlockerMessage: PAYOUT_MISSING uses the exact prescribed copy", () => {
  assert.equal(getBlockerMessage("PAYOUT_MISSING"), "The payout still needs to be recorded and confirmed.");
});

test("getBlockerMessage: PAYOUT_NOT_CONFIRMED uses the exact prescribed copy", () => {
  assert.equal(
    getBlockerMessage("PAYOUT_NOT_CONFIRMED"),
    "The payout has been recorded. The recipient still needs to confirm that it was received.",
  );
});

test("getBlockerMessage: PAYOUT_DISPUTED uses the exact prescribed copy and contains no fix/retry/resolve/override/refund/adjudicate language", () => {
  const message = getBlockerMessage("PAYOUT_DISPUTED");
  assert.equal(
    message,
    "The recipient disputed this payout. Under the current NIA workflow, this round cannot advance.",
  );
  for (const forbidden of ["resolve", "correct", "retry", "replace", "override", "refund", "adjudicate", "fix"]) {
    assert.ok(!message.toLowerCase().includes(forbidden), `expected no "${forbidden}" in the disputed-blocker message`);
  }
});

test("getBlockerMessage: all four blockers produce four distinct messages", () => {
  const messages = new Set([
    getBlockerMessage("CONTRIBUTIONS_INCOMPLETE"),
    getBlockerMessage("PAYOUT_MISSING"),
    getBlockerMessage("PAYOUT_NOT_CONFIRMED"),
    getBlockerMessage("PAYOUT_DISPUTED"),
  ]);
  assert.equal(messages.size, 4);
});

test("getAdvanceCtaLabel: non-final round names both halves of the atomic operation", () => {
  assert.equal(getAdvanceCtaLabel("ADVANCE_TO_NEXT_ROUND", 2, 3), "Close round 2 & start round 3");
});

test("getAdvanceCtaLabel: final round says 'Close final round', never implying circle completion", () => {
  const label = getAdvanceCtaLabel("CLOSE_FINAL_ROUND", 4, null);
  assert.equal(label, "Close final round");
  for (const forbidden of ["complete", "Complete", "finish", "Finish", "archive", "Archive"]) {
    assert.ok(!label.includes(forbidden), `expected no "${forbidden}" in the final-round CTA label`);
  }
});

test("getAdvanceCtaLabel: a null nextRoundNumber always yields the final-round label, regardless of transitionKind", () => {
  // Defensive consistency: transitionKind and nextRound presence always
  // agree in a genuine getOwnerRoundLifecycle result, but this function
  // never trusts transitionKind alone over the display value it was
  // actually given.
  assert.equal(getAdvanceCtaLabel("ADVANCE_TO_NEXT_ROUND", 4, null), "Close final round");
});

test("getAdvanceCtaLabel performs no arithmetic of its own -- both round numbers are used verbatim", () => {
  assert.equal(getAdvanceCtaLabel("ADVANCE_TO_NEXT_ROUND", 7, 8), "Close round 7 & start round 8");
  assert.equal(getAdvanceCtaLabel("ADVANCE_TO_NEXT_ROUND", 1, 2), "Close round 1 & start round 2");
});
