import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- this route statically imports next/navigation's
// redirect() and is therefore not safe to import/execute directly under
// the plain Node test harness (see member-dashboard.test.ts's own
// identical methodology for the pre-existing dashboard wiring this file
// extends). No DOM/React render is exercised here.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("the page authorizes via requireCircleMember before fetching either read model", () => {
  const authorizeIndex = source.indexOf("requireCircleMember(circleId)");
  const dashboardFetchIndex = source.indexOf("getCircleMemberDashboard(identity)");
  const payoutsFetchIndex = source.indexOf("getCircleMemberPayouts(identity)");
  assert.ok(authorizeIndex >= 0, "expected requireCircleMember(circleId) to be called");
  assert.ok(dashboardFetchIndex >= 0, "expected getCircleMemberDashboard(identity) to be called");
  assert.ok(payoutsFetchIndex >= 0, "expected getCircleMemberPayouts(identity) to be called");
  assert.ok(authorizeIndex < dashboardFetchIndex, "authorization must happen before the dashboard read");
  assert.ok(authorizeIndex < payoutsFetchIndex, "authorization must happen before the payout read");
});

test("getCircleMemberPayouts is called with the SAME trusted identity object as the existing dashboard read, in the same Promise.all", () => {
  assert.match(
    source,
    /Promise\.all\(\[\s*getCircleMemberDashboard\(identity\),\s*getCircleMemberPayouts\(identity\),?\s*\]\)/,
  );
});

test("the page never derives memberId from params, searchParams, or any client-suppliable value", () => {
  assert.doesNotMatch(source, /searchParams/);
  assert.doesNotMatch(source, /memberId\s*[:=]\s*circleId/);
  assert.doesNotMatch(source, /\.get\(\s*["']memberId["']\s*\)/);
});

test("every MemberPayouts* not-found/authorization/not-eligible failure collapses to the same redirect as the dashboard's own failures -- but NOT an integrity error", () => {
  assert.match(source, /MemberPayoutsCircleNotFoundError/);
  assert.match(source, /MemberPayoutsCircleNotEligibleError/);
  assert.match(source, /MemberPayoutsMemberNotFoundError/);
  assert.match(source, /MemberPayoutsMemberNotActiveError/);
  assert.match(source, /redirect\(\s*["']\/member\/login["']\s*\)/);
  // A genuine persisted-integrity corruption must never be silently
  // misrepresented as a login redirect -- left to propagate, exactly like
  // any other truly unexpected error this page doesn't recognize.
  assert.doesNotMatch(source, /MemberPayoutsIntegrityError/);
});

test("the existing member dashboard is still rendered, unmodified, wrapping the new payout card as a child -- not replaced", () => {
  assert.match(source, /<MemberDashboard dashboard=\{dashboard\}>/);
  assert.match(source, /<MemberPayoutCard circleId=\{circleId\} payouts=\{payouts\} \/>/);
});

test("the FULL getCircleMemberPayouts result is passed to MemberPayoutCard -- not a single pre-filtered round, and not the raw dashboard payload reused", () => {
  assert.doesNotMatch(source, /payouts=\{payouts\.recipientRounds/);
  assert.doesNotMatch(source, /payouts=\{dashboard/);
});

test("no owner-facing payout read model is imported on the member route", () => {
  assert.doesNotMatch(source, /payout-owner-read/);
  assert.doesNotMatch(source, /getOwnerCirclePayouts/);
});

test("no API route or client-side fetch is used for payout data -- the read model is awaited directly, server-side", () => {
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /\/api\//);
  assert.match(rawSource, /await getCircleMemberPayouts|await Promise\.all/);
});

test("the destination page is a server component with no client-side auth of its own beyond the trusted member session", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
});

test("no financial mutation call or round/circle lifecycle mutation exists on this page", () => {
  assert.doesNotMatch(source, /\.create\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of ["closeRound", "activateNextRound", "completeCircle"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
