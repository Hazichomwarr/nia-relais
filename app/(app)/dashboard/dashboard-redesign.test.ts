import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
import { formatDate, getFrequencyLabel, getStatusLabel } from "@/src/i18n/format";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("./dashboard-previews.tsx", import.meta.url), "utf8");
const trustedSource = readFileSync(new URL("./trusted-person-dashboard-card.tsx", import.meta.url), "utf8");

test("dashboard composes authoritative goal, circle, and trusted-person reads", () => {
  for (const read of ["getPersonalGoalsForDashboard", "getCirclesForOwnerIndex", "getCustodianInboxForUser", "getPendingDepositsForCustodian"]) {
    assert.match(pageSource, new RegExp(read));
  }
  assert.match(pageSource, /activeGoals\.length/);
  assert.match(pageSource, /circle\.status === "ACTIVE"/);
  assert.match(pageSource, /pendingInvitations\.length \+ pendingDeposits\.length/);
});

test("dashboard follows the hero, summary, two-capability, trusted-person composition", () => {
  const hero = pageSource.indexOf("copy.heroWelcomeBack");
  const summary = pageSource.indexOf("<DashboardSummary");
  const savings = pageSource.indexOf("copy.personalSavings");
  const circles = pageSource.indexOf("dictionary.common.susuCircles");
  const trusted = pageSource.lastIndexOf("<TrustedPersonDashboardCard");
  assert.ok(hero < summary && summary < savings && savings < circles && circles < trusted);
});

test("preview cards stay compact and use only safe authoritative data", () => {
  assert.match(pageSource, /activeGoals\.slice/);
  assert.match(previewSource, /goal\.savedAmount/);
  assert.match(previewSource, /goal\.targetAmount/);
  assert.match(previewSource, /circle\.currentOrNextRound/);
  assert.match(previewSource, /round\.recipientDisplayName/);
  assert.doesNotMatch(previewSource, /memberCode|CustodianAssignmentForm|Record savings|ContributionPayment/);
});

test("dashboard uses the typed dictionary for French and English hero, preview, and trusted-person copy", () => {
  assert.equal(en.dashboard.heroWelcomeBack, "Welcome back");
  assert.equal(fr.dashboard.heroWelcomeBack, "Bon retour");
  assert.equal(en.dashboard.personalSavings, "Personal savings");
  assert.equal(fr.dashboard.personalSavings, "Mon épargne");
  assert.equal(en.dashboard.createCircle, "Create circle");
  assert.equal(fr.dashboard.createCircle, "Créer un cercle");
  assert.equal(en.dashboard.nothingWaiting, "Nothing waiting for you right now.");
  assert.equal(fr.dashboard.nothingWaiting, "Rien ne vous attend pour le moment.");
  assert.match(pageSource, /getDictionary\(locale\)/);
  assert.match(previewSource, /dictionary\.dashboard/);
  assert.match(trustedSource, /dictionary\.dashboard/);
});

test("dashboard localizes persisted status, frequency, and UTC-safe dates through shared helpers", () => {
  assert.equal(getStatusLabel("ACTIVE", fr), "Actif");
  assert.equal(getStatusLabel("COMPLETED", fr), "Terminé");
  assert.equal(getFrequencyLabel("WEEKLY", "fr"), "chaque semaine");
  assert.equal(formatDate("2026-09-14", "fr"), "14 septembre 2026");
  assert.match(previewSource, /getStatusLabel\(circle\.status, dictionary\)/);
  assert.match(previewSource, /getFrequencyLabel\(circle\.frequency, locale\)/);
  assert.match(previewSource, /formatDate\(goal\.unlockDate, locale\)/);
});

test("user-created goal, circle, and member names remain direct display values", () => {
  assert.match(previewSource, /\{goal\.name\}/);
  assert.match(previewSource, /\{circle\.name\}/);
  assert.match(previewSource, /\{round\.recipientDisplayName\}/);
  assert.match(trustedSource, /\{activeAssignment\.ownerName\}/);
  assert.match(trustedSource, /\{activeAssignment\.goal\.name\}/);
  assert.doesNotMatch(`${JSON.stringify(en.dashboard)}${JSON.stringify(fr.dashboard)}`, /Africa Go Back Funds|Compaore Basil/);
});

test("trusted-person section has both calm zero state and authoritative waiting state", () => {
  assert.match(trustedSource, /copy\.nothingWaiting/);
  assert.match(trustedSource, /copy\.waitingForConfirmation/);
  assert.match(trustedSource, /pendingInvitations\.length \+ pendingDeposits\.length/);
});
