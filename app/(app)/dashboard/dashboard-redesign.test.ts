import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("Home composes authoritative counts for the three primary destinations", () => {
  for (const read of ["getPersonalGoalsForDashboard", "getCirclesForOwnerIndex", "getCustodianInboxForUser", "getPendingDepositsForCustodian"]) {
    assert.match(pageSource, new RegExp(read));
  }
  assert.match(pageSource, /goal\.status === "ACTIVE"/);
  assert.match(pageSource, /circle\.status === "ACTIVE"/);
  assert.match(pageSource, /assignment\.status === "PENDING"/);
  assert.match(pageSource, /\+ pendingDeposits\.length/);
});

test("Home presents three whole-card links to the established experiences", () => {
  assert.match(pageSource, /<Link href=\{href\}/);
  assert.match(pageSource, /HomeCard href="\/deposits"/);
  assert.match(pageSource, /HomeCard href="\/circles"/);
  assert.match(pageSource, /HomeCard href="\/custodian"/);
});

test("Home removes management previews and summary composition", () => {
  for (const removedSurface of ["DashboardSummary", "DashboardGoalPreview", "DashboardCirclePreview", "TrustedPersonDashboardCard", "activeGoals.slice"]) {
    assert.doesNotMatch(pageSource, new RegExp(removedSurface));
  }
});

test("Home keeps its English and French orientation copy in the typed dictionary", () => {
  assert.equal(en.common.dashboard, "Home");
  assert.equal(fr.common.dashboard, "Accueil");
  assert.equal(en.dashboard.homeSavingsGoalOne, "{count} savings goal");
  assert.equal(en.dashboard.homeSavingsGoalsMany, "{count} savings goals");
  assert.equal(fr.dashboard.homeSavingsGoalOne, "{count} objectif d’épargne");
  assert.equal(fr.dashboard.homeSavingsGoalsMany, "{count} objectifs d’épargne");
  assert.equal(en.dashboard.homeWaitingMany, "{count} items waiting");
  assert.equal(fr.dashboard.homeWaitingMany, "{count} éléments en attente");
  assert.match(pageSource, /getDictionary\(locale\)/);
  assert.match(pageSource, /homeSavingsGoalOne/);
  assert.match(pageSource, /homeActiveCircleOne/);
  assert.match(pageSource, /homeWaitingOne/);
});
