import assert from "node:assert/strict";
import test from "node:test";

import { buildContributionRestatement, getFrequencyLabel } from "./new-circle-form-display";

test("getFrequencyLabel produces human labels for the supported frequencies", () => {
  assert.equal(getFrequencyLabel("WEEKLY"), "every week");
  assert.equal(getFrequencyLabel("BIWEEKLY"), "every two weeks");
  assert.equal(getFrequencyLabel("MONTHLY"), "every month");
});

test("buildContributionRestatement echoes the typed amount/currency/frequency without recalculating anything", () => {
  const restatement = buildContributionRestatement({
    contributionAmount: "25.00",
    currency: "USD",
    frequency: "WEEKLY",
  });
  assert.equal(restatement, "Each member will contribute USD 25.00 every week.");
});

test("buildContributionRestatement returns null while the amount is incomplete or malformed", () => {
  assert.equal(buildContributionRestatement({ contributionAmount: "", currency: "USD", frequency: "WEEKLY" }), null);
  assert.equal(buildContributionRestatement({ contributionAmount: "abc", currency: "USD", frequency: "WEEKLY" }), null);
  assert.equal(buildContributionRestatement({ contributionAmount: "25.00", currency: "", frequency: "WEEKLY" }), null);
});

test("buildContributionRestatement never mentions a round, a due date, or a schedule", () => {
  const restatement = buildContributionRestatement({
    contributionAmount: "25.00",
    currency: "USD",
    frequency: "MONTHLY",
  });
  assert.doesNotMatch((restatement ?? "").toLowerCase(), /round|due date|schedule/);
});
