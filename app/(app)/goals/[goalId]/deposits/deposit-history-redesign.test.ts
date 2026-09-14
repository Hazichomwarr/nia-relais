import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
import { formatDate } from "@/src/i18n/format";

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
  assert.match(pageSource, /copy\.awaitingConfirmation/);
  assert.match(pageSource, /copy\.notConfirmed/);
});

test("history uses compact navigable rows and preserves friendly canonical status labels", () => {
  assert.match(itemSource, /<li>/);
  assert.match(itemSource, /\/goals\/\$\{encodeURIComponent\(deposit\.goalId\)\}\/deposits\/\$\{encodeURIComponent\(deposit\.id\)\}/);
  assert.doesNotMatch(itemSource, /View record/);
  assert.match(displaySource, /deposit\.status === "APPROVED"/);
  assert.match(displaySource, /deposit\.status === "PENDING"/);
  assert.match(displaySource, /label: copy\.confirmed/);
  assert.match(displaySource, /label: copy\.awaitingConfirmation/);
  assert.match(displaySource, /label: copy\.notConfirmed/);
});

test("history filters and lifecycle-aware actions remain intact", () => {
  assert.match(filterSource, /name="status"/);
  assert.match(filterSource, /name="range"/);
  assert.match(pageSource, /goal\.status === "ACTIVE"/);
  assert.match(pageSource, /goal\.status === "ACTIVE"/);
  assert.match(pageSource, /copy\.firstSavingTitle/);
  assert.match(pageSource, /copy\.filteredEmpty/);
  assert.match(pageSource, /copy\.aboutGoal/);
});

test("savings presentation keeps canonical filters and localizes EN/FR status and UTC dates", () => {
  assert.equal(en.personalSavings.awaitingConfirmation, "Awaiting confirmation");
  assert.equal(fr.personalSavings.awaitingConfirmation, "En attente de confirmation");
  assert.equal(formatDate("2026-09-14", "fr"), "14 septembre 2026");
  assert.match(filterSource, /value="APPROVED"/);
  assert.match(filterSource, /value="PENDING"/);
  assert.match(filterSource, /value="REJECTED"/);
});
