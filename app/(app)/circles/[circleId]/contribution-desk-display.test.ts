import assert from "node:assert/strict";
import test from "node:test";

import {
  canRecordFreshContribution,
  findActiveRecordedPayment,
  formatContributionDateTime,
  formatContributionMoney,
  getObligationStatusPresentation,
  getPaymentStatusPresentation,
  groupObligationsByRoundId,
  groupPaymentsByObligationId,
  sortPaymentsNewestFirst,
} from "./contribution-desk-display";
import type {
  OwnerContributionsObligationResult,
  OwnerContributionsPaymentResult,
} from "@/src/services/contribution-owner-read.service";

function obligation(overrides: Partial<OwnerContributionsObligationResult> = {}): OwnerContributionsObligationResult {
  return {
    id: "obligation-1",
    roundId: "round-1",
    memberId: "member-1",
    memberDisplayName: "Amara",
    memberCode: "ABCDEF0123456789",
    expectedAmount: "50.00",
    currency: "USD",
    dueDate: "2026-01-01T00:00:00.000Z",
    status: "OPEN",
    fulfilledAt: null,
    confirmedAmount: "0.00",
    outstandingAmount: "50.00",
    ...overrides,
  };
}

function payment(overrides: Partial<OwnerContributionsPaymentResult> = {}): OwnerContributionsPaymentResult {
  return {
    id: "payment-1",
    obligationId: "obligation-1",
    amount: "50.00",
    currency: "USD",
    status: "RECORDED",
    clientOperationId: "op-1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    recordedById: "owner-1",
    confirmedAt: null,
    confirmedById: null,
    rejectedAt: null,
    rejectedById: null,
    rejectionReason: null,
    ...overrides,
  };
}

// --- money/date formatting ---

test("formatContributionMoney groups thousands and pads to two decimals", () => {
  assert.equal(formatContributionMoney("1234.5", "USD"), "USD 1,234.50");
  assert.equal(formatContributionMoney("50.00", "USD"), "USD 50.00");
});

test("formatContributionMoney never re-parses or recalculates the amount, only formats the given string", () => {
  assert.equal(formatContributionMoney("0.00", "USD"), "USD 0.00");
});

test("formatContributionDateTime renders a real date and time, not raw ISO text", () => {
  const formatted = formatContributionDateTime("2026-03-05T14:30:00.000Z");
  assert.doesNotMatch(formatted, /T\d{2}:\d{2}:\d{2}/);
  assert.match(formatted, /2026/);
});

// --- status presentation ---

test("getObligationStatusPresentation labels OPEN and FULFILLED verbatim", () => {
  assert.equal(getObligationStatusPresentation("OPEN").label, "Open");
  assert.equal(getObligationStatusPresentation("FULFILLED").label, "Fulfilled");
});

test("getPaymentStatusPresentation gives distinct wording for RECORDED, CONFIRMED, and REJECTED", () => {
  const recorded = getPaymentStatusPresentation("RECORDED");
  const confirmed = getPaymentStatusPresentation("CONFIRMED");
  const rejected = getPaymentStatusPresentation("REJECTED");

  assert.equal(recorded.label, "Recorded");
  assert.match(recorded.description, /not yet confirmed/i);
  assert.equal(confirmed.label, "Confirmed");
  assert.match(confirmed.description, /outside NIA/i);
  assert.equal(rejected.label, "Rejected");
  assert.match(rejected.description, /not accepted/i);

  // Three genuinely distinct presentations -- never collapsed to one.
  assert.notEqual(recorded.label, confirmed.label);
  assert.notEqual(confirmed.label, rejected.label);
  assert.notEqual(recorded.className, rejected.className);
});

// --- round grouping ---

test("groupObligationsByRoundId groups every obligation under its own round, dropping none", () => {
  const obligations = [
    obligation({ id: "o1", roundId: "r1" }),
    obligation({ id: "o2", roundId: "r1" }),
    obligation({ id: "o3", roundId: "r2" }),
  ];
  const grouped = groupObligationsByRoundId(obligations);

  assert.deepEqual(grouped.get("r1")?.map((o) => o.id), ["o1", "o2"]);
  assert.deepEqual(grouped.get("r2")?.map((o) => o.id), ["o3"]);
});

// --- payment grouping / history visibility ---

test("groupPaymentsByObligationId keeps every payment attempt, including REJECTED history", () => {
  const payments = [
    payment({ id: "p1", obligationId: "o1", status: "REJECTED", rejectedAt: "2026-01-01T00:00:00.000Z", rejectedById: "owner-1", rejectionReason: "wrong amount" }),
    payment({ id: "p2", obligationId: "o1", status: "CONFIRMED", confirmedAt: "2026-01-02T00:00:00.000Z", confirmedById: "owner-1" }),
    payment({ id: "p3", obligationId: "o2", status: "RECORDED" }),
  ];
  const grouped = groupPaymentsByObligationId(payments);

  assert.deepEqual(
    grouped.get("o1")?.map((p) => p.status),
    ["REJECTED", "CONFIRMED"],
  );
  assert.deepEqual(grouped.get("o2")?.map((p) => p.status), ["RECORDED"]);
});

test("rejected history remains grouped and visible even after a later payment confirms the same obligation", () => {
  const payments = [
    payment({ id: "p1", obligationId: "o1", status: "REJECTED", rejectedAt: "2026-01-01T00:00:00.000Z", rejectedById: "owner-1", rejectionReason: "short" }),
    payment({ id: "p2", obligationId: "o1", status: "CONFIRMED", confirmedAt: "2026-01-03T00:00:00.000Z", confirmedById: "owner-1" }),
  ];
  const grouped = groupPaymentsByObligationId(payments);

  assert.equal(grouped.get("o1")?.length, 2);
  assert.ok(grouped.get("o1")?.some((p) => p.status === "REJECTED"));
  assert.ok(grouped.get("o1")?.some((p) => p.status === "CONFIRMED"));
});

test("sortPaymentsNewestFirst orders by recordedAt descending, stable on id ties", () => {
  const payments = [
    payment({ id: "p1", recordedAt: "2026-01-01T00:00:00.000Z" }),
    payment({ id: "p2", recordedAt: "2026-01-03T00:00:00.000Z" }),
    payment({ id: "p3", recordedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  const sorted = sortPaymentsNewestFirst(payments);
  assert.deepEqual(sorted.map((p) => p.id), ["p2", "p3", "p1"]);
});

test("findActiveRecordedPayment finds the one RECORDED attempt among a mixed history", () => {
  const payments = [
    payment({ id: "p1", status: "REJECTED", rejectedAt: "2026-01-01T00:00:00.000Z", rejectedById: "owner-1", rejectionReason: "x" }),
    payment({ id: "p2", status: "RECORDED" }),
  ];
  assert.equal(findActiveRecordedPayment(payments)?.id, "p2");
});

test("findActiveRecordedPayment returns undefined when no RECORDED attempt exists", () => {
  const payments = [
    payment({ id: "p1", status: "CONFIRMED", confirmedAt: "2026-01-01T00:00:00.000Z", confirmedById: "owner-1" }),
  ];
  assert.equal(findActiveRecordedPayment(payments), undefined);
});

// --- eligibility derivation (7J.7 section 10) ---

test("a FULFILLED obligation can never accept a fresh recording", () => {
  assert.equal(canRecordFreshContribution(obligation({ status: "FULFILLED" }), []), false);
});

test("an OPEN obligation with an active RECORDED attempt cannot accept a second recording", () => {
  const payments = [payment({ status: "RECORDED" })];
  assert.equal(canRecordFreshContribution(obligation({ status: "OPEN" }), payments), false);
});

test("an OPEN obligation with no RECORDED/CONFIRMED attempt can accept a fresh recording", () => {
  assert.equal(canRecordFreshContribution(obligation({ status: "OPEN" }), []), true);
});

test("an OPEN obligation with only historical REJECTED attempts can still accept a fresh recording", () => {
  const payments = [
    payment({ status: "REJECTED", rejectedAt: "2026-01-01T00:00:00.000Z", rejectedById: "owner-1", rejectionReason: "x" }),
  ];
  assert.equal(canRecordFreshContribution(obligation({ status: "OPEN" }), payments), true);
});

test("defensively, an OPEN obligation next to a (theoretically impossible) CONFIRMED payment still refuses a fresh recording", () => {
  const payments = [payment({ status: "CONFIRMED", confirmedAt: "2026-01-01T00:00:00.000Z", confirmedById: "owner-1" })];
  assert.equal(canRecordFreshContribution(obligation({ status: "OPEN" }), payments), false);
});
