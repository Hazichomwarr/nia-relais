import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const indexSource = readFileSync(new URL("../deposits/page.tsx", import.meta.url), "utf8");
const newGoalSource = readFileSync(new URL("./new/new-goal-form.tsx", import.meta.url), "utf8");
const newDepositSource = readFileSync(new URL("./[goalId]/deposits/new/deposit-form.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./[goalId]/deposits/[depositId]/page.tsx", import.meta.url), "utf8");

test("Personal Savings index, creation, recording, and detail use the typed EN/FR dictionary", () => {
  assert.equal(en.personalSavings.newGoalTitle, "Build something worth waiting for.");
  assert.equal(fr.personalSavings.newGoalTitle, "Construisez quelque chose qui mérite d’être attendu.");
  assert.equal(en.personalSavings.recordSavings, "Record savings");
  assert.equal(fr.personalSavings.recordSavings, "Enregistrer une épargne");
  assert.match(indexSource, /copy = dictionary\.personalSavings/);
  assert.match(newGoalSource, /copy\.timelineDescription/);
  assert.match(newDepositSource, /copy\.pendingSuccessDescription/);
  assert.match(detailSource, /copy\.verificationDetails/);
});

test("Personal Savings keeps user-created goal names and deposit notes as direct values", () => {
  assert.match(newDepositSource, /\{goal\.name\}/);
  assert.match(detailSource, /\{authority\.goal\.name\}/);
  assert.match(detailSource, /\{deposit\.note\}/);
  assert.doesNotMatch(JSON.stringify(fr.personalSavings), /Africa Go Back Funds|September savings from Uber/);
});
