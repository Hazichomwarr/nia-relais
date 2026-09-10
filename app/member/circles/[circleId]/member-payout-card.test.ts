import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural/source checks only -- no DOM/React render is exercised, no
// browser or E2E behavior is claimed anywhere in this file. This mirrors
// payout-desk.test.ts's own identical methodology for the owner-side
// sibling component.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./member-payout-card.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a server component (no \"use client\") -- it only orchestrates, it does not mutate", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
});

test("renders the read model's own recipientRounds -- no direct Prisma access, no duplicate read model, no obligation summing", () => {
  assert.match(source, /payouts\.recipientRounds\[0\]/);
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /\.findMany\(/);
  assert.doesNotMatch(source, /\.findUnique\(/);
  assert.doesNotMatch(source, /computeExpectedPayoutAmount/);
  assert.doesNotMatch(source, /\.reduce\(/, "expected no client-side summation of obligation amounts");
});

test("a zero-recipient-round result renders nothing -- truthful omission, never a fabricated payout or an error page", () => {
  assert.match(source, /if \(!round\) return null;/);
});

test("round information (round number, due date, expected payout) is shown -- never derived from payoutOrder/frequency/member count", () => {
  assert.match(source, /round\.roundNumber/);
  assert.match(source, /round\.dueDate/);
  assert.match(source, /round\.expectedPayout\.amount/);
  assert.match(source, /round\.expectedPayout\.currency/);
  for (const forbidden of ["payoutOrder", "frequency", "memberCount", "member.length"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("payout status is derived via getMemberPayoutStatusPresentation from payout.status or null -- never guessed from round.status", () => {
  assert.match(source, /getMemberPayoutStatusPresentation\(payout \? payout\.status : null\)/);
});

test("decision controls are rendered only when canDecidePayout allows it, and take no round.status argument", () => {
  assert.match(source, /const canDecide = canDecidePayout\(payout\);/);
  assert.match(source, /\{canDecide && payout \? \(/);
  assert.match(source, /<MemberPayoutControls circleId=\{circleId\} payoutId=\{payout\.id\} \/>/);
});

test("a recorded payout's disputeReason is rendered exactly, when present", () => {
  assert.match(source, /payout\?\.disputeReason/);
});

test("no actor id (recordedById/confirmedByMemberId/disputedByMemberId) or clientOperationId is rendered", () => {
  for (const forbidden of ["recordedById", "confirmedByMemberId", "disputedByMemberId", "clientOperationId"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no owner recording action or round/circle lifecycle mutation control is ever rendered", () => {
  for (const forbidden of [
    "recordPayoutAction",
    "Record payout",
    "closeRound",
    "activateNextRound",
    "completeCircle",
    "round.status =",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no PIN, pinHash, or other credential/session field is ever rendered", () => {
  for (const forbidden of ["pinHash", "failedPinAttempts", "credentialVersion", "sessions", "tokenHash", "memberCode", "\\bpin\\b"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }
});

test("no member-auth dependency and no direct financial mutation call", () => {
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /\.create\(/);
  assert.doesNotMatch(source, /\.update\(/);
});

test("no owner-facing payout read model is imported into member UI", () => {
  assert.doesNotMatch(source, /payout-owner-read/);
  assert.doesNotMatch(source, /getOwnerCirclePayouts/);
});

test("copy positions NIA as a recorder of external payouts, not a money sender/holder/mover", () => {
  assert.match(source, /NIA records payouts that happen\s+outside the app/);
  assert.match(source, /does not send, hold, or\s+transfer money/i);
  for (const forbidden of [/send payout/i, /pay member/i, /transfer funds/i, /release money/i, /process payment/i, /receive money in nia/i, /funds sent/i, /transfer complete/i, /money released/i]) {
    assert.doesNotMatch(source, forbidden);
  }
});
