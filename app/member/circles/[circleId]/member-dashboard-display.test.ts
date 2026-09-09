import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCircleDate,
  formatCircleDateTime,
  formatCircleMoney,
  getCircleStatusLabel,
  getFrequencyLabel,
  getObligationStatusPresentation,
  getPayoutPresentation,
  getRoundStatusPresentation,
  isMemberRecipientRound,
  selectRoundHeading,
} from "./member-dashboard-display";

// Pure-function tests -- no DB, no React, no fixtures. These cover the
// wording/labeling rules the 7H.3 ticket specifies exactly.

test("formatCircleMoney groups thousands and pads to two decimals without recalculating the value", () => {
  assert.equal(formatCircleMoney("1234.5", "USD"), "USD 1,234.50");
  assert.equal(formatCircleMoney("0.00", "USD"), "USD 0.00");
});

test("formatCircleMoney drops the decimal for a whole XOF amount, per the existing app convention", () => {
  assert.equal(formatCircleMoney("5000.00", "XOF"), "XOF 5,000");
  assert.equal(formatCircleMoney("5000.50", "XOF"), "XOF 5,000.50");
});

test("formatCircleDate and formatCircleDateTime render calendar dates/timestamps", () => {
  assert.equal(formatCircleDate("2026-01-01"), "January 1, 2026");
  assert.equal(formatCircleDate("2026-01-08T00:00:00.000Z"), "January 8, 2026");
  assert.match(formatCircleDateTime("2026-01-08T14:30:00.000Z"), /2026/);
});

test("getFrequencyLabel and getCircleStatusLabel produce human labels", () => {
  assert.equal(getFrequencyLabel("WEEKLY"), "Every week");
  assert.equal(getFrequencyLabel("BIWEEKLY"), "Every two weeks");
  assert.equal(getFrequencyLabel("MONTHLY"), "Every month");
  assert.equal(getCircleStatusLabel("ACTIVE"), "Active");
  assert.equal(getCircleStatusLabel("COMPLETED"), "Completed");
  assert.equal(getCircleStatusLabel("ARCHIVED"), "Archived");
});

test("getRoundStatusPresentation never describes UPCOMING as active or currently collecting", () => {
  const upcoming = getRoundStatusPresentation("UPCOMING");
  assert.equal(upcoming.label, "Upcoming");
  assert.doesNotMatch(upcoming.label.toLowerCase(), /active|collecting/);

  assert.equal(getRoundStatusPresentation("ACTIVE").label, "Active");
  assert.equal(getRoundStatusPresentation("CLOSED").label, "Closed");
});

test("getObligationStatusPresentation reflects only the service's own fulfilled boolean", () => {
  assert.equal(getObligationStatusPresentation({ fulfilled: true }).label, "Fulfilled");
  assert.equal(getObligationStatusPresentation({ fulfilled: false }).label, "Outstanding");
});

// --- payout wording, exactly per the 7H.3 spec ---

test("getPayoutPresentation: null payout reads 'Not yet recorded.'", () => {
  assert.equal(getPayoutPresentation(null).description, "Not yet recorded.");
});

test("getPayoutPresentation: RECORDED never claims confirmed receipt", () => {
  const presentation = getPayoutPresentation({
    roundNumber: 1,
    amount: "100.00",
    status: "RECORDED",
    recordedAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: null,
    disputedAt: null,
  });
  assert.equal(presentation.description, "Recorded by the circle owner — awaiting your confirmation.");
  assert.doesNotMatch(presentation.description.toLowerCase(), /receipt confirmed/);
});

test("getPayoutPresentation: CONFIRMED reads 'Receipt confirmed.'", () => {
  const presentation = getPayoutPresentation({
    roundNumber: 1,
    amount: "100.00",
    status: "CONFIRMED",
    recordedAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-02T00:00:00.000Z",
    disputedAt: null,
  });
  assert.equal(presentation.description, "Receipt confirmed.");
});

test("getPayoutPresentation: DISPUTED reads 'Receipt disputed.'", () => {
  const presentation = getPayoutPresentation({
    roundNumber: 1,
    amount: "100.00",
    status: "DISPUTED",
    recordedAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: null,
    disputedAt: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(presentation.description, "Receipt disputed.");
});

// --- current vs. upcoming vs. historical selection ---

const roundEntry = (overrides: Partial<{ roundNumber: number; dueDate: string; status: string; recipientDisplayName: string }> = {}) => ({
  roundNumber: 1,
  dueDate: "2026-01-01T00:00:00.000Z",
  status: "UPCOMING",
  recipientDisplayName: "Fixture Member",
  ...overrides,
});

test("selectRoundHeading: an ACTIVE circle with a currentRound is labeled 'current'", () => {
  const heading = selectRoundHeading({
    currentRound: roundEntry({ status: "ACTIVE" }),
    nextRound: null,
    circle: { status: "ACTIVE" } as never,
  });
  assert.equal(heading.kind, "current");
});

test("selectRoundHeading: an ACTIVE circle with only a nextRound is labeled 'next', never 'current'", () => {
  const heading = selectRoundHeading({
    currentRound: null,
    nextRound: roundEntry({ status: "UPCOMING" }),
    circle: { status: "ACTIVE" } as never,
  });
  assert.equal(heading.kind, "next");
});

test("selectRoundHeading: a COMPLETED circle with neither round selected is 'historical', not 'none'", () => {
  const heading = selectRoundHeading({
    currentRound: null,
    nextRound: null,
    circle: { status: "COMPLETED" } as never,
  });
  assert.equal(heading.kind, "historical");
});

test("selectRoundHeading: an ARCHIVED circle with neither round selected is also 'historical'", () => {
  const heading = selectRoundHeading({
    currentRound: null,
    nextRound: null,
    circle: { status: "ARCHIVED" } as never,
  });
  assert.equal(heading.kind, "historical");
});

// --- rotation ordering / own-round highlight ---

test("isMemberRecipientRound matches only the round whose roundNumber equals the member's payoutOrder", () => {
  assert.equal(isMemberRecipientRound(roundEntry({ roundNumber: 2 }), 2), true);
  assert.equal(isMemberRecipientRound(roundEntry({ roundNumber: 1 }), 2), false);
  assert.equal(isMemberRecipientRound(roundEntry({ roundNumber: 1 }), null), false);
});
