import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const source = ["page.tsx", "custodian-assignment-card.tsx", "custodian-pending-deposit-card.tsx", "custodian-relationship-row.tsx", "custodian-inbox-filters.tsx"]
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))
  .join("\n");

test("custodian presentation provides EN/FR trusted-person and savings terminology", () => {
  assert.equal(en.custodian.eyebrow, "Trusted person");
  assert.equal(fr.custodian.eyebrow, "Personne de confiance");
  assert.equal(en.custodian.approve, "Approve saving");
  assert.equal(fr.custodian.approve, "Approuver l’épargne");
  assert.equal(en.custodian.pending, "Pending");
  assert.equal(fr.custodian.pending, "En attente");
});

test("localized custodian components preserve canonical actions, ids, and user-created data", () => {
  for (const value of ["assignmentId", "depositId", "assignment.goal.name", "deposit.goal.name", "deposit.note"]) {
    assert.ok(source.includes(value), `expected preserved ${value}`);
  }
  assert.match(source, /dictionary\.custodian|const copy = dictionary\.custodian/);
  assert.doesNotMatch(source, /custodian\.[a-z]+\s*\?\?/);
});
