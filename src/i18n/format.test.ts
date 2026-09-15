import assert from "node:assert/strict";
import test from "node:test";

import { formatDate, formatMoney, getCurrencyDisplayCode } from "./format";

test("XOF remains canonical in code while displaying as CFA", () => {
  assert.equal(getCurrencyDisplayCode("XOF"), "CFA");
  assert.equal(formatMoney("25000.00", "XOF"), "CFA 25,000");
});

test("other V1 currency codes remain unchanged in presentation", () => {
  assert.equal(formatMoney("12.50", "USD"), "USD 12.50");
  assert.equal(formatMoney("12.50", "EUR"), "EUR 12.50");
  assert.equal(formatMoney("12.50", "GBP"), "GBP 12.50");
});

test("SUSU owner ISO lifecycle and schedule instants format without creating an invalid Date", () => {
  // Owner read models intentionally serialize PayoutRound.dueDate and
  // SavingsCircle.completedAt with toISOString(). Previously formatDate
  // appended another UTC time portion, triggering RangeError in Intl.
  const dueDate = "2026-09-20T00:00:00.000Z";
  assert.equal(formatDate(dueDate, "en"), "September 20, 2026");
  assert.equal(formatDate(dueDate, "fr"), "20 septembre 2026");
});

test("date-only calendar values stay UTC-safe", () => {
  assert.equal(formatDate("2026-01-01", "en"), "January 1, 2026");
  assert.equal(formatDate("2026-01-01", "fr"), "1 janvier 2026");
});
