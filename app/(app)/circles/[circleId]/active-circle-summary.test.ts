import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./active-circle-summary.tsx", import.meta.url), "utf8"),
);

// 9H §25: this file's own literal-English-string assertions were stale
// before this session began, from an unrelated, pre-existing, uncommitted
// localization pass that converted this component to read every label from
// `dictionary`/`copy` (see owner-susu-localization-closeout.test.ts, which
// already covers this same file's localization directly) -- determined,
// not assumed, via source inspection (git show HEAD's committed version
// still has the literal strings this test originally asserted). Updated
// here to assert the dictionary-driven equivalent, per 9H's own explicit
// "update stale tests to the current intended contract" instruction.

test("renders circle name, ACTIVE badge, contribution terms, and activation date", () => {
  assert.match(source, /circle\.name/);
  assert.match(source, /financial\.active/);
  assert.equal(en.susuFinancial.active, "Active");
  assert.match(source, /circle\.contributionAmount/);
  assert.match(source, /circle\.activatedAt/);
});

test("renders member count and the ordered member list", () => {
  assert.match(source, /members\.length/);
  assert.match(source, /members\.map/);
  assert.match(source, /member\.payoutOrder/);
});

test("renders the full rotation schedule and the current/next round summary", () => {
  assert.match(source, /rounds\.map/);
  assert.match(source, /currentRound/);
  assert.match(source, /nextRound/);
});

test("shows a clear empty state when no round is currently ACTIVE", () => {
  assert.match(source, /copy\.noActiveRound/);
  assert.equal(en.susuOwner.noActiveRound, "No round is currently active.");
});

test("states plainly that members, terms, and payout order are now fixed", () => {
  assert.match(source, /copy\.activeCircleDescription/);
  assert.match(en.susuOwner.activeCircleDescription, /can no longer\s+be changed/);
});

test("never implies contributions have been collected or payouts made merely because rounds exist", () => {
  assert.match(source, /copy\.rotationProgress/);
  assert.match(en.susuOwner.rotationProgress, /does not mean any contribution has been collected or any payout made/);
});

test("no recording or confirmation button exists anywhere on this page", () => {
  assert.doesNotMatch(source, /<button/i);
  assert.doesNotMatch(source, /<form/i);
});

test("no financial payment/payout total is computed or rendered -- out of scope for this ticket", () => {
  for (const forbidden of ["confirmedContributionTotal", "expectedCollection", "ContributionPayment", "Payout.amount", "outstandingAmount"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("ordinary owner summaries hide member codes and never render PIN or credential fields", () => {
  assert.doesNotMatch(source, /member\.memberCode/);
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
  const rawSource = readFileSync(new URL("./active-circle-summary.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(rawSource, /^"use client";?/m);
});
