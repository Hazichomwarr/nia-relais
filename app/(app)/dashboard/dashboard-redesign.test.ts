import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  const hero = pageSource.indexOf("Welcome back");
  const summary = pageSource.indexOf("<DashboardSummary");
  const savings = pageSource.indexOf("Personal savings");
  const circles = pageSource.indexOf("SUSU circles");
  const trusted = pageSource.lastIndexOf("<TrustedPersonDashboardCard");
  assert.ok(hero < summary && summary < savings && savings < circles && circles < trusted);
  assert.doesNotMatch(pageSource, /copy\.newGoal/);
});

test("preview cards stay compact and use only safe authoritative data", () => {
  assert.match(pageSource, /activeGoals\.slice/);
  assert.match(previewSource, /goal\.savedAmount/);
  assert.match(previewSource, /goal\.targetAmount/);
  assert.match(previewSource, /circle\.currentOrNextRound/);
  assert.match(previewSource, /round\.recipientDisplayName/);
  assert.doesNotMatch(previewSource, /memberCode|CustodianAssignmentForm|Record savings|ContributionPayment/);
});

test("trusted-person section has both calm zero state and authoritative waiting state", () => {
  assert.match(trustedSource, /Nothing waiting for you right now/);
  assert.match(trustedSource, /waiting for your confirmation/);
  assert.match(trustedSource, /pendingInvitations\.length \+ pendingDeposits\.length/);
});
