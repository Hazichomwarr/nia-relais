import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural/source checks only -- no DOM/React render is exercised, no
// browser or E2E behavior is claimed anywhere in this file. This mirrors
// contribution-desk.test.ts's own identical methodology for the sibling
// owner desk component.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./payout-desk.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a server component (no \"use client\") -- it only orchestrates, it does not mutate", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
});

test("renders the read model's own rounds and summary -- no direct Prisma access, no duplicate read model, no obligation summing", () => {
  assert.match(source, /const \{ rounds, summary \} = payouts;/);
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /\.findMany\(/);
  assert.doesNotMatch(source, /\.findUnique\(/);
  assert.doesNotMatch(source, /computeExpectedPayoutAmount/);
  assert.doesNotMatch(source, /\.reduce\(/, "expected no client-side summation of obligation amounts");
});

test("each round shows its round number, recipient display name/memberCode, due date, persisted status, and the authoritative expected payout", () => {
  assert.match(source, /round\.roundNumber/);
  assert.match(source, /round\.recipient\.displayName/);
  assert.match(source, /round\.recipient\.memberCode/);
  assert.match(source, /formatOwnerDate\(round\.dueDate\)/);
  assert.match(source, /getRoundStatusBadge\(round\.status\)/);
  assert.match(source, /round\.expectedPayout\.amount/);
  assert.match(source, /round\.expectedPayout\.currency/);
});

test("payout status is derived via getPayoutStatusPresentation from payout.status or null -- never guessed from round.status", () => {
  assert.match(source, /getPayoutStatusPresentation\(round\.payout \? round\.payout\.status : null\)/);
});

test("the record-payout form is rendered only when canRecordFreshPayout allows it, and takes no round.status argument", () => {
  assert.match(source, /const canRecord = canRecordFreshPayout\(round\.payout\);/);
  assert.match(source, /\{canRecord \? \(\s*<div className="mt-4">\s*<RecordPayoutForm/);
});

test("a RECORDED/CONFIRMED/DISPUTED payout renders its amount, recorded date, and (when present) confirmed/disputed date and dispute reason", () => {
  assert.match(source, /formatContributionMoney\(round\.payout\.amount, round\.payout\.currency\)/);
  assert.match(source, /formatContributionDateTime\(round\.payout\.recordedAt\)/);
  assert.match(source, /round\.payout\.confirmedAt/);
  assert.match(source, /round\.payout\.disputedAt/);
  assert.match(source, /round\.payout\.disputeReason/);
});

test("the summary area shows totalRounds/unrecordedCount/recordedCount/confirmedCount/disputedCount verbatim -- no reinterpreted counts", () => {
  for (const field of ["summary.totalRounds", "summary.unrecordedCount", "summary.recordedCount", "summary.confirmedCount", "summary.disputedCount"]) {
    assert.ok(source.includes(field), `expected the summary to render ${field}`);
  }
});

test("the owner sees no confirm/dispute/resolve/retry/replace/delete/reverse payout controls -- only the recipient may act on a payout", () => {
  for (const forbidden of [
    "Confirm payout",
    "Dispute payout",
    "Resolve dispute",
    "Retry payout",
    "Replace payout",
    "Delete payout",
    "Reverse payout",
    "confirmPayoutAction",
    "disputePayoutAction",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no PIN, pinHash, or other credential/session field is ever rendered", () => {
  for (const forbidden of ["pinHash", "failedPinAttempts", "credentialVersion", "sessions", "tokenHash", "\\bpin\\b"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }
});

test("no actor id (recordedById/confirmedByMemberId/disputedByMemberId) is rendered", () => {
  for (const forbidden of ["recordedById", "confirmedByMemberId", "disputedByMemberId"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no member-auth dependency and no direct financial mutation call", () => {
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /\.create\(/);
  assert.doesNotMatch(source, /\.update\(/);
});

test("no round-lifecycle mutation language exists anywhere in this component", () => {
  // "round.status =" would catch an assignment TO the persisted status;
  // the component's own local `const roundStatus = getRoundStatusBadge(...)`
  // display variable is a read, not a mutation, and is deliberately not
  // flagged here.
  for (const forbidden of ["closeRound", "activateNextRound", "completeCircle", "round.status ="]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("copy positions NIA as a recorder of external payouts, not a money sender/holder/mover, and avoids execution-implying verbs", () => {
  assert.match(source, /NIA records payouts that happen\s+outside the app/);
  assert.match(source, /does not send, hold, or transfer/i);
  for (const forbidden of [/send payout/i, /pay member/i, /transfer funds/i, /release money/i, /process payment/i]) {
    assert.doesNotMatch(source, forbidden);
  }
});
