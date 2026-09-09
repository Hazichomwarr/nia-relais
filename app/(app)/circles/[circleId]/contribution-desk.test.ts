import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./contribution-desk.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a server component (no \"use client\") -- it only orchestrates, it does not mutate", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
});

test("renders the read model's own rounds, grouped obligations, and payments -- no direct Prisma access, no duplicate read model", () => {
  assert.match(source, /contributions\.rounds|const \{ rounds, obligations, payments \} = contributions;/);
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /\.findMany\(/);
  assert.doesNotMatch(source, /\.findUnique\(/);
});

test("rounds are grouped via groupObligationsByRoundId and obligations via groupPaymentsByObligationId -- no ad-hoc filtering reimplemented inline", () => {
  assert.match(source, /groupObligationsByRoundId\(obligations\)/);
  assert.match(source, /groupPaymentsByObligationId\(payments\)/);
});

test("each round shows its round number, recipient, due date, and persisted status", () => {
  assert.match(source, /round\.roundNumber/);
  assert.match(source, /round\.recipientDisplayName/);
  assert.match(source, /formatOwnerDate\(round\.dueDate\)/);
  assert.match(source, /getRoundStatusBadge\(round\.status\)/);
});

test("each obligation shows member display name, member code, expected/confirmed/outstanding amounts, and persisted status", () => {
  assert.match(source, /obligation\.memberDisplayName/);
  assert.match(source, /obligation\.memberCode/);
  assert.match(source, /obligation\.expectedAmount/);
  assert.match(source, /obligation\.confirmedAmount/);
  assert.match(source, /obligation\.outstandingAmount/);
  assert.match(source, /getObligationStatusPresentation\(obligation\.status\)/);
});

test("every payment attempt is rendered via history.map with no status filter -- REJECTED history is never hidden", () => {
  assert.match(source, /history\.map/);
  assert.doesNotMatch(source, /payments\.filter\(\s*\(?\s*p(?:ayment)?\s*\)?\s*=>\s*\w+\.status\s*!==\s*"REJECTED"/);
  assert.doesNotMatch(source, /\.filter\([^)]*status[^)]*RECORDED[^)]*\)/);
});

test("payment history items show amount, status, recorded/confirmed/rejected times, and rejection reason -- but no actor id", () => {
  assert.match(source, /formatContributionMoney\(payment\.amount, payment\.currency\)/);
  assert.match(source, /getPaymentStatusPresentation\(payment\.status\)/);
  assert.match(source, /formatContributionDateTime\(payment\.recordedAt\)/);
  assert.match(source, /payment\.confirmedAt/);
  assert.match(source, /payment\.rejectedAt/);
  assert.match(source, /payment\.rejectionReason/);
  for (const forbidden of ["recordedById", "confirmedById", "rejectedById"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("the record-contribution form is rendered only when canRecordFreshContribution allows it", () => {
  assert.match(source, /const canRecord = canRecordFreshContribution\(obligation, payments\);/);
  assert.match(source, /\{canRecord \? \(\s*<div className="mt-4">\s*<RecordContributionForm/);
});

test("confirm/reject controls are rendered only for a RECORDED payment", () => {
  assert.match(source, /payment\.status === "RECORDED" \? \(/);
  assert.match(source, /<ContributionPaymentControls circleId=\{circleId\} paymentId=\{payment\.id\} \/>/);
});

test("no PIN, pinHash, or other credential/session field is ever rendered", () => {
  for (const forbidden of ["pinHash", "failedPinAttempts", "credentialVersion", "sessions", "tokenHash", "\\bpin\\b"]) {
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

test("copy positions NIA as a tracker, not a money holder/mover", () => {
  assert.match(source, /NIA tracks the circle; it does not hold or move the money/);
});
