import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";

// Structural checks on the actual server component source -- no DOM/React
// render is exercised here (matches active-circle-summary.test.ts's own
// identical methodology for a non-client component in this route).
//
// 9H §25: several assertions below were stale before this session began,
// from an unrelated, pre-existing, uncommitted localization pass that
// converted this component to read every label from `dictionary`/`copy`
// and replaced the old standalone `getBlockerMessage` helper with an
// inline ternary (determined via source inspection against the file's
// last-committed version, not assumed) -- updated to assert the
// dictionary-driven equivalent, per 9H's own "update stale tests to the
// current intended contract" instruction. This is unrelated to, and
// predates, this session's own 9E/9F IMPORTED_PREFIX_AWAITING_FIRST_ROUND
// work, which is covered separately by
// round-lifecycle-card-imported-prefix.test.ts.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./round-lifecycle-card.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a plain server component (no 'use client'), rendering exactly the OwnerRoundLifecycleResult shape", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
  assert.match(source, /import type \{ OwnerRoundLifecycleResult \} from "@\/src\/services\/round-lifecycle-owner-read\.service";/);
});

test("renders the closedRounds / totalRounds progress figure straight from the read model, never from a rendered array's own length", () => {
  assert.match(source, /\{closedRounds\}\s*\/\s*\{totalRounds\}/);
  assert.doesNotMatch(source, /\.length\s*\/\s*/);
});

// --- NOT_STARTED ---

const notStartedBranch = source.slice(source.indexOf('phase === "NOT_STARTED"'), source.indexOf('phase === "IN_PROGRESS"'));

test("NOT_STARTED: explains the rotation has not started, shows round 1 as next, and renders StartFirstRoundForm only when canStartFirstRound", () => {
  assert.match(notStartedBranch, /copy\.notStartedDescription/);
  assert.match(en.susuFinancial.notStartedDescription, /has not started yet/);
  assert.match(notStartedBranch, /<RoundSummary label=\{`\$\{copy\.round\} 1`\} round=\{nextRound\} dictionary=\{dictionary\} \/>/);
  assert.match(notStartedBranch, /progression\.canStartFirstRound \? <StartFirstRoundForm circleId=\{circleId\} dictionary=\{dictionary\} \/> : null/);
});

test("NOT_STARTED: never gates on a date (startDate/dueDate/current date)", () => {
  assert.doesNotMatch(notStartedBranch, /startDate/);
  assert.doesNotMatch(notStartedBranch, /Date\.now\(\)/);
  assert.doesNotMatch(notStartedBranch, /new Date\(/);
});

test("NOT_STARTED: never implies automatic collection or payout", () => {
  for (const forbidden of [/automatically collect/i, /will be paid/i, /will be sent/i]) {
    assert.doesNotMatch(notStartedBranch, forbidden);
  }
});

// --- IN_PROGRESS ---

const inProgressBranch = source.slice(source.indexOf('phase === "IN_PROGRESS"'), source.indexOf('phase === "ALL_ROUNDS_CLOSED"'));

test("IN_PROGRESS: renders the current round and, if present, the next round -- both from the read model's own persisted fields", () => {
  assert.match(inProgressBranch, /<RoundSummary label=\{copy\.currentRound\} round=\{currentRound\} dictionary=\{dictionary\} \/>/);
  assert.match(inProgressBranch, /nextRound \? <RoundSummary label=\{copy\.nextRound\} round=\{nextRound\} dictionary=\{dictionary\} \/> : null/);
});

test("IN_PROGRESS: shows the blocker message only when progression.blocker is set, mapped verbatim from progression.blocker's own value", () => {
  assert.match(inProgressBranch, /\{progression\.blocker \? \(/);
  assert.match(
    inProgressBranch,
    /progression\.blocker === "CONTRIBUTIONS_INCOMPLETE" \? copy\.waitingContributions : progression\.blocker === "PAYOUT_DISPUTED" \? copy\.payoutDisputed : copy\.waitingPayout/,
  );
});

test("IN_PROGRESS: renders AdvanceRoundForm only when progression.canAdvanceCurrentRound is true -- never independently re-derived", () => {
  assert.match(inProgressBranch, /\{progression\.canAdvanceCurrentRound && currentRound \? \(/);
  assert.match(inProgressBranch, /<AdvanceRoundForm/);
});

test("IN_PROGRESS: AdvanceRoundForm is passed circleId and currentRound.id only as identifiers, plus display-only round numbers/transitionKind", () => {
  const advanceFormCall = inProgressBranch.slice(inProgressBranch.indexOf("<AdvanceRoundForm"), inProgressBranch.indexOf("/>", inProgressBranch.indexOf("<AdvanceRoundForm")) + 2);
  assert.match(advanceFormCall, /circleId=\{circleId\}/);
  assert.match(advanceFormCall, /roundId=\{currentRound\.id\}/);
  assert.match(advanceFormCall, /currentRoundNumber=\{currentRound\.roundNumber\}/);
  assert.match(advanceFormCall, /nextRoundNumber=\{nextRound \? nextRound\.roundNumber : null\}/);
  for (const forbidden of ["nextRoundId=", "closedAt=", "closedById=", "activatedAt=", "activatedById=", "status=", "ownerId="]) {
    assert.ok(!advanceFormCall.includes(forbidden), `expected no "${forbidden}" prop passed to AdvanceRoundForm`);
  }
});

test("IN_PROGRESS: never renders a Start-first-round control alongside the advance control (one lifecycle action at a time)", () => {
  assert.doesNotMatch(inProgressBranch, /StartFirstRoundForm/);
});

// --- ALL_ROUNDS_CLOSED ---

const allClosedBranch = source.slice(source.indexOf('phase === "ALL_ROUNDS_CLOSED"'));

test("ALL_ROUNDS_CLOSED: states every round is closed and that the circle is not yet marked complete, with no round-lifecycle control rendered", () => {
  assert.match(allClosedBranch, /copy\.allRoundsClosed/);
  assert.equal(en.susuFinancial.allRoundsClosed, "All rotation rounds are closed.");
  assert.match(allClosedBranch, /copy\.completionPending/);
  assert.match(en.susuFinancial.completionPending, /has not yet been marked complete in NIA/);
  assert.doesNotMatch(allClosedBranch, /StartFirstRoundForm/);
  assert.doesNotMatch(allClosedBranch, /AdvanceRoundForm/);
});

test("ALL_ROUNDS_CLOSED: renders CompleteCircleForm -- the completion CTA's sole authority is phase === \"ALL_ROUNDS_CLOSED\" itself, no independent readiness check (7L.3 section 7)", () => {
  assert.match(allClosedBranch, /<CompleteCircleForm circleId=\{circleId\} dictionary=\{dictionary\} \/>/);
});

test("the completion CTA is rendered ONLY inside the ALL_ROUNDS_CLOSED branch -- never in NOT_STARTED or IN_PROGRESS", () => {
  assert.doesNotMatch(notStartedBranch, /CompleteCircleForm/);
  assert.doesNotMatch(inProgressBranch, /CompleteCircleForm/);
});

test("ALL_ROUNDS_CLOSED: never claims the circle status is already COMPLETED, never says 'Finish SUSU'/'Archive circle', and this file itself never asserts status: COMPLETED", () => {
  for (const forbidden of [/circle is completed/i, /finish susu/i, /archive circle/i, /status: "?COMPLETED"?/]) {
    assert.doesNotMatch(allClosedBranch, forbidden);
  }
});

// --- authority boundary across the whole file ---

test("no financial data (ContributionPayment/ContributionObligation/Payout fields) is ever inspected for eligibility", () => {
  for (const forbidden of [
    "ContributionPayment",
    "ContributionObligation",
    "payout.status",
    "confirmedAt",
    "disputeReason",
    "expectedPayout",
    ".every(",
    ".filter(",
    ".reduce(",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct Prisma, repository, lifecycle-service-write, or completion-service reference -- the completion CTA is rendered only via the CompleteCircleForm component, never a raw service/action call", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of [
    "@/src/repositories/round-lifecycle.repository",
    "@/src/repositories/round-lifecycle-owner-read.repository",
    "@/src/repositories/circle-lock.repository",
    "@/src/repositories/circle-completion.repository",
    "@/src/services/circle-completion.service",
    "@/src/actions/complete-circle",
    "@/src/actions/circle-completion.actions",
    "activateFirstRound(",
    "advanceRound(",
    "completeCircle(",
    "completeCircleAction",
    "runCompleteCircleAction",
    "completeSavingsCircle",
    "archiveCircle",
    "completedById",
    "completedAt",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
  // The one, sole reference to circle completion this file may ever have:
  // importing the already-built CompleteCircleForm component.
  assert.match(source, /import \{ CompleteCircleForm \} from "\.\/complete-circle-controls";/);
});

test("no date-based eligibility logic anywhere in this file", () => {
  assert.doesNotMatch(source, /Date\.now\(\)/);
  assert.doesNotMatch(source, /new Date\(/);
});

test("recipient identity comes only from round.recipient, never payoutOrder or a member-list position", () => {
  // 9H §25: this card only renders round.recipient.displayName, not
  // .memberCode, as of the same pre-existing, unrelated localization pass
  // noted above -- memberCode remains available on the read model's own
  // OwnerRoundLifecycleRecipientResult type (round-lifecycle-owner-read
  // .service.ts) and is still shown elsewhere in the same owner workspace
  // (payout-desk.tsx/contribution-desk.tsx), so this is a display-only
  // omission on this one card, not a privacy or authority boundary this
  // test needs to protect. What this test protects -- recipient identity
  // never derived from payoutOrder or a member-list position -- still
  // holds.
  assert.match(source, /round\.recipient\.displayName/);
  assert.doesNotMatch(source, /payoutOrder/);
});
