import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- mirrors active-circle-summary.test.ts's own
// identical methodology for the sibling terminal-state summary.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./completed-circle-summary.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("renders circle name, COMPLETED badge, contribution terms, start date, and completion date", () => {
  assert.match(source, /circle\.name/);
  assert.match(source, />\s*COMPLETED\s*</);
  assert.match(source, /circle\.contributionAmount/);
  assert.match(source, /formatOwnerDate\(circle\.startDate\)/);
  assert.match(source, /formatOwnerDate\(circle\.completedAt\)/);
});

test("renders member count and the ordered member list", () => {
  assert.match(source, /memberCount/);
  assert.match(source, /members\.map/);
  assert.match(source, /member\.payoutOrder/);
});

test("uses the frozen product copy: 'Circle complete' -- never a celebratory or financial-transfer claim", () => {
  assert.match(source, /Circle complete\. All rotation rounds were closed and this circle was marked complete\./);
  for (const forbidden of [
    /funds transferred/i,
    /money (was )?sent/i,
    /payout completed by nia/i,
    /distributed by nia/i,
    /archive/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("no round schedule, no contribution/payout figures -- that is ContributionDesk/PayoutDesk's own job, not duplicated here", () => {
  for (const forbidden of ["rounds.map", "ContributionPayment", "Payout.amount", "expectedPayout", "obligation", "payment.status"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no mutation, lifecycle, or completion control of any kind -- this is a terminal historical view", () => {
  assert.doesNotMatch(source, /<button/i);
  assert.doesNotMatch(source, /<form/i);
  for (const forbidden of [
    "CompleteCircleForm",
    "StartFirstRoundForm",
    "AdvanceRoundForm",
    "RecordContributionForm",
    "RecordPayoutForm",
    "completeCircleAction",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no actor id (completedById/activatedById) is ever rendered", () => {
  for (const forbidden of ["completedById", "activatedById"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("member codes are shown, but no PIN or credential field is ever rendered", () => {
  assert.match(source, /member\.memberCode/);
  assert.doesNotMatch(source, /\bpin\b/i);
  assert.doesNotMatch(source, /pinHash/);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
});

test("this component is a server component (no \"use client\")", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
});
