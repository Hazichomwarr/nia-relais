import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./active-circle-summary.tsx", import.meta.url), "utf8"),
);

test("renders circle name, ACTIVE badge, contribution terms, and activation date", () => {
  assert.match(source, /circle\.name/);
  assert.match(source, />\s*ACTIVE\s*</);
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
  assert.match(source, /No round is currently active/);
});

test("states plainly that members, terms, and payout order are now fixed", () => {
  assert.match(source, /can no longer\s+be changed/);
});

test("never implies contributions have been collected or payouts made merely because rounds exist", () => {
  assert.match(source, /does not mean any contribution has been collected or any payout made/);
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
  const rawSource = readFileSync(new URL("./active-circle-summary.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(rawSource, /^"use client";?/m);
});
