import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

import { getHistoryDisclosure, HISTORY_PREVIEW_COUNT } from "./deposit-history-disclosure";

const listSource = readFileSync(new URL("./deposit-history-list.tsx", import.meta.url), "utf8");

test("five or fewer matching records remain fully visible without disclosure", () => {
  const records = [1, 2, 3, 4, 5];
  const disclosure = getHistoryDisclosure(records, false);

  assert.equal(HISTORY_PREVIEW_COUNT, 5);
  assert.deepEqual(disclosure.visibleRecords, records);
  assert.equal(disclosure.hasHiddenRecords, false);
});

test("collapsed history preserves authoritative order and reports the correct hidden count", () => {
  const records = Array.from({ length: 17 }, (_, index) => index + 1);
  const disclosure = getHistoryDisclosure(records, false);

  assert.deepEqual(disclosure.visibleRecords, [1, 2, 3, 4, 5]);
  assert.equal(disclosure.hiddenCount, 12);
  assert.deepEqual(records, Array.from({ length: 17 }, (_, index) => index + 1));
});

test("expanding makes the complete matching record set visible without mutation", () => {
  const records = Array.from({ length: 8 }, (_, index) => index + 1);
  const disclosure = getHistoryDisclosure(records, true);

  assert.deepEqual(disclosure.visibleRecords, records);
  assert.equal(disclosure.hiddenCount, 3);
  assert.equal(disclosure.hasHiddenRecords, true);
});

test("filter changes are synchronously collapsed and copy remains localized", () => {
  assert.match(listSource, /const expanded = expandedFor === filterKey/);
  assert.match(listSource, /setExpandedFor\(expanded \? null : filterKey\)/);
  assert.match(listSource, /aria-expanded=\{expanded\}/);
  assert.equal(en.personalSavings.savingRecordedOne, "{count} saving recorded");
  assert.equal(en.personalSavings.viewMoreSavings, "View {count} more");
  assert.equal(en.personalSavings.showLess, "Show less");
  assert.equal(fr.personalSavings.savingsRecordedMany, "{count} épargnes enregistrées");
  assert.equal(fr.personalSavings.viewMoreSavings, "Voir {count} de plus");
  assert.equal(fr.personalSavings.showLess, "Afficher moins");
});
