import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const itemSource = readFileSync(new URL("./deposit-history-item.tsx", import.meta.url), "utf8");
const displaySource = readFileSync(new URL("./deposit-display.ts", import.meta.url), "utf8");
const filterSource = readFileSync(new URL("./deposit-history-filters.tsx", import.meta.url), "utf8");

test("savings record composes only the established owner and deposit-history reads", () => {
  assert.match(pageSource, /requireGoalOwner\(goalId\)/);
  assert.match(pageSource, /getDepositHistoryForGoal\(goal\.id\)/);
  assert.match(pageSource, /confirmedDeposits = deposits\.filter\(\(deposit\) => deposit\.status === "APPROVED"\)/);
  assert.doesNotMatch(pageSource, /createDeposit\(|updateDeposit|deleteDeposit|correction/i);
});

test("summary preserves confirmed-only accounting and Decimal-safe progress presentation", () => {
  assert.match(pageSource, /new Prisma\.Decimal\(0\)/);
  assert.match(pageSource, /confirmedTotal\.div\(goal\.targetAmount\)\.mul\(100\)/);
  assert.match(pageSource, /formatDepositAmount\(confirmedTotal\.toFixed\(2\), goal\.currency\)/);
  assert.match(pageSource, /Awaiting confirmation/);
  assert.match(pageSource, /Not confirmed/);
});

test("history uses compact navigable rows and preserves friendly canonical status labels", () => {
  assert.match(itemSource, /<li>/);
  assert.match(itemSource, /\/goals\/\$\{encodeURIComponent\(deposit\.goalId\)\}\/deposits\/\$\{encodeURIComponent\(deposit\.id\)\}/);
  assert.doesNotMatch(itemSource, /View record/);
  assert.match(displaySource, /deposit\.status === "APPROVED"/);
  assert.match(displaySource, /deposit\.status === "PENDING"/);
  assert.match(displaySource, /label: "Confirmed"/);
  assert.match(displaySource, /label: "Awaiting confirmation"/);
  assert.match(displaySource, /label: "Not confirmed"/);
});

test("history filters and lifecycle-aware actions remain intact", () => {
  assert.match(filterSource, /name="status"/);
  assert.match(filterSource, /name="range"/);
  assert.match(pageSource, /goal\.status === "ACTIVE"/);
  assert.match(pageSource, /Every journey starts with a first step\./);
  assert.match(pageSource, /No savings match these filters\./);
  assert.match(pageSource, /About this goal/);
});
