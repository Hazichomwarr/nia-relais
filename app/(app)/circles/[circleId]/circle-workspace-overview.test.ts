import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./circle-workspace-overview.tsx", import.meta.url), "utf8");

test("the active overview is composed from existing summary, contribution, payout, and lifecycle read results", () => {
  assert.match(source, /summary: ActiveCircleOwnerSummaryResult/);
  assert.match(source, /contributions: OwnerCircleContributionsResult/);
  assert.match(source, /payouts: OwnerCirclePayoutsResult/);
  assert.match(source, /lifecycle: OwnerRoundLifecycleResult/);
  assert.doesNotMatch(source, /prisma\.|getOwnerCircle|getActiveCircle/);
});

test("the overview provides the premium header, summary strip, current round, payout, member, and schedule previews", () => {
  for (const heading of ["Contribution", "Members", "Started", "Round", "Current round", "Next payout", "Upcoming rounds"]) {
    assert.ok(source.includes(heading), `expected ${heading}`);
  }
  assert.match(source, /Record contributions/);
  assert.match(source, /View payouts/);
  assert.match(source, /View all/);
  assert.match(source, /Full schedule/);
});

test("progress and payout copy are mapped from authoritative serialized values instead of new eligibility logic", () => {
  assert.match(source, /item\.outstandingAmount === "0\.00"/);
  assert.match(source, /lifecycle\.progression\.blocker/);
  assert.match(source, /getPayoutStatusPresentation/);
  assert.doesNotMatch(source, /canRecordFreshPayout|canAdvanceCurrentRound|computeExpectedPayout|new Prisma/);
});

test("ordinary overview previews never render member codes or member ids", () => {
  assert.doesNotMatch(source, /memberCode/);
  assert.doesNotMatch(source, /memberId/);
});
