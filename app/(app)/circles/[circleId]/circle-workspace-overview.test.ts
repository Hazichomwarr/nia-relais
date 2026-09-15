import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const source = readFileSync(new URL("./circle-workspace-overview.tsx", import.meta.url), "utf8");

test("the active overview is composed from existing summary, contribution, payout, and lifecycle read results", () => {
  assert.match(source, /summary: ActiveCircleOwnerSummaryResult/);
  assert.match(source, /contributions: OwnerCircleContributionsResult/);
  assert.match(source, /payouts: OwnerCirclePayoutsResult/);
  assert.match(source, /lifecycle: OwnerRoundLifecycleResult/);
  assert.doesNotMatch(source, /prisma\.|getOwnerCircle|getActiveCircle/);
});

test("the overview provides the premium header, summary strip, current round, payout, member, and schedule previews", () => {
  for (const key of ["contribution", "members", "started", "round", "currentRound", "nextPayout", "upcomingRounds"]) {
    assert.match(source, new RegExp(`copy\\.${key}`));
  }
  assert.equal(en.susuWorkspace.currentRound, "Current round");
  assert.equal(fr.susuWorkspace.currentRound, "Tour en cours");
  assert.match(source, /copy\.recordContributions/);
  assert.match(source, /copy\.viewPayouts/);
  assert.match(source, /copy\.viewAll/);
  assert.match(source, /copy\.fullSchedule/);
});

test("progress and payout copy are mapped from authoritative serialized values instead of new eligibility logic", () => {
  // 9H §25: this file's own local getPayoutState helper (not the imported
  // payout-desk-display.ts getPayoutStatusPresentation) has been how this
  // component maps payout copy since before this session began -- an
  // unrelated, pre-existing, uncommitted refactor (determined via source
  // inspection, not assumed). It still reads only round.payout?.status and
  // lifecycle.progression.blocker verbatim -- the same authoritative-
  // values guarantee this test protects, just via a differently-named
  // function. Updated to assert the actual current helper.
  assert.match(source, /item\.outstandingAmount === "0\.00"/);
  assert.match(source, /lifecycle\.progression\.blocker/);
  assert.match(source, /function getPayoutState\(/);
  assert.match(source, /round\.payout\?\.status === "RECORDED"/);
  assert.match(source, /round\.payout\?\.status === "CONFIRMED"/);
  assert.doesNotMatch(source, /canRecordFreshPayout|canAdvanceCurrentRound|computeExpectedPayout|new Prisma/);
});

test("ordinary overview previews never render member codes or member ids", () => {
  assert.doesNotMatch(source, /memberCode/);
  assert.doesNotMatch(source, /memberId/);
});
