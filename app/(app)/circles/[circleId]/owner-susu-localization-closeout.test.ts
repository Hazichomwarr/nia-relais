import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const files = [
  "active-circle-summary.tsx",
  "completed-circle-summary.tsx",
  "circle-member-read-list.tsx",
  "circle-workspace-overview.tsx",
  "loading.tsx",
] as const;

const source = files.map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");

test("owner SUSU closeout copy has EN and FR dictionary values without raw translation keys", () => {
  assert.equal(en.susuOwner.contribution, "Contribution");
  assert.equal(fr.susuOwner.contribution, "Cotisation");
  assert.equal(en.susuFinancial.payout, "Payout");
  assert.equal(fr.susuFinancial.payout, "Versement");
  assert.equal(en.susuFinancial.recipient, "Recipient");
  assert.equal(fr.susuFinancial.recipient, "Bénéficiaire");
  assert.equal(en.susuFinancial.round, "Round");
  assert.equal(fr.susuFinancial.round, "Tour");
  assert.equal(fr.susuOwner.payoutOrder, "Ordre des versements");
  assert.doesNotMatch(source, /susuOwner\.[a-z]+\s*\?\?/);
});

test("localized presentation retains member, recipient, currency, amount, and persisted status values", () => {
  for (const value of ["member.displayName", "recipientDisplayName", "circle.currency", "circle.contributionAmount", "round.status"]) {
    assert.ok(source.includes(value), `expected preserved value ${value}`);
  }
  assert.doesNotMatch(source, /\.toUpperCase\(\).*status/);
});

test("the closeout components use the established owner dictionaries instead of renderable English literals", () => {
  assert.match(source, /dictionary\.susuOwner|const copy = dictionary\.susuOwner/);
  assert.match(source, /getDictionary\(await getLocale\(\)\)/);
  for (const literal of ["Loading your circle…", "Active member", "No payout is scheduled yet", "Full rotation schedule"]) {
    assert.doesNotMatch(source, new RegExp(literal));
  }
});
