import assert from "node:assert/strict";
import test from "node:test";

import { addUtcCalendarMonths, addUtcDays, roundDueDate } from "./circle-rotation-schedule";

test("addUtcDays adds whole days in UTC", () => {
  const start = new Date(Date.UTC(2026, 0, 1));
  assert.equal(addUtcDays(start, 7).toISOString(), new Date(Date.UTC(2026, 0, 8)).toISOString());
  assert.equal(addUtcDays(start, 14).toISOString(), new Date(Date.UTC(2026, 0, 15)).toISOString());
});

test("addUtcCalendarMonths preserves the original day of month", () => {
  const start = new Date(Date.UTC(2026, 0, 15)); // Jan 15
  assert.equal(addUtcCalendarMonths(start, 1).toISOString(), new Date(Date.UTC(2026, 1, 15)).toISOString());
  assert.equal(addUtcCalendarMonths(start, 12).toISOString(), new Date(Date.UTC(2027, 0, 15)).toISOString());
});

test("addUtcCalendarMonths clamps to the last day of a shorter target month", () => {
  const start = new Date(Date.UTC(2026, 0, 31)); // Jan 31
  // Feb 2026 has 28 days
  assert.equal(addUtcCalendarMonths(start, 1).toISOString(), new Date(Date.UTC(2026, 1, 28)).toISOString());
});

test("addUtcCalendarMonths handles a leap-year February correctly", () => {
  const start = new Date(Date.UTC(2028, 0, 31)); // Jan 31, 2028 (leap year)
  assert.equal(addUtcCalendarMonths(start, 1).toISOString(), new Date(Date.UTC(2028, 1, 29)).toISOString());
});

test("roundDueDate: WEEKLY advances 7 days per completed round", () => {
  const circle = { frequency: "WEEKLY" as const, startDate: new Date(Date.UTC(2026, 0, 1)) };
  assert.equal(roundDueDate(circle, 1).toISOString(), new Date(Date.UTC(2026, 0, 1)).toISOString());
  assert.equal(roundDueDate(circle, 2).toISOString(), new Date(Date.UTC(2026, 0, 8)).toISOString());
  assert.equal(roundDueDate(circle, 3).toISOString(), new Date(Date.UTC(2026, 0, 15)).toISOString());
});

test("roundDueDate: BIWEEKLY advances 14 days per completed round", () => {
  const circle = { frequency: "BIWEEKLY" as const, startDate: new Date(Date.UTC(2026, 0, 1)) };
  assert.equal(roundDueDate(circle, 2).toISOString(), new Date(Date.UTC(2026, 0, 15)).toISOString());
  assert.equal(roundDueDate(circle, 3).toISOString(), new Date(Date.UTC(2026, 0, 29)).toISOString());
});

test("roundDueDate: MONTHLY preserves the original day and clamps at month end", () => {
  const circle = { frequency: "MONTHLY" as const, startDate: new Date(Date.UTC(2026, 0, 31)) };
  assert.equal(roundDueDate(circle, 1).toISOString(), new Date(Date.UTC(2026, 0, 31)).toISOString());
  assert.equal(roundDueDate(circle, 2).toISOString(), new Date(Date.UTC(2026, 1, 28)).toISOString());
  assert.equal(roundDueDate(circle, 3).toISOString(), new Date(Date.UTC(2026, 2, 31)).toISOString());
});
