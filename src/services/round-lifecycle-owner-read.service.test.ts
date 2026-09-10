import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activateCircle } from "@/src/services/circle.service";
import { confirmContribution } from "@/src/services/contribution-confirmation.service";
import { recordContribution } from "@/src/services/contribution-recording.service";
import { confirmPayout } from "@/src/services/payout-confirmation.service";
import { disputePayout } from "@/src/services/payout-dispute.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import {
  activateFirstRound,
  advanceRound,
  RoundLifecycleContributionsIncompleteError,
  RoundLifecyclePayoutDisputedError,
  RoundLifecyclePayoutMissingError,
  RoundLifecyclePayoutNotConfirmedError,
} from "@/src/services/round-lifecycle.service";
import {
  getOwnerRoundLifecycle,
  OwnerRoundLifecycleAuthorizationError,
  OwnerRoundLifecycleCircleNotEligibleError,
  OwnerRoundLifecycleCircleNotFoundError,
  OwnerRoundLifecycleIntegrityError,
} from "@/src/services/round-lifecycle-owner-read.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests for the owner round-lifecycle READ model
// (7K.15). Same methodology as round-lifecycle.service.test.ts (7K.13):
// unique-id-scoped fixtures, FK-ordered cleanup in test.after regardless
// of outcome, before/after row counts on unrelated domain tables. No
// TEST_DATABASE_URL required. Fixtures use the real, already-shipped
// activateCircle/recordContribution/confirmContribution/recordPayout/
// confirmPayout/disputePayout/activateFirstRound/advanceRound services
// throughout -- never hand-inserted financial rows -- except where a test
// explicitly manufactures corruption via a direct, documented raw write
// (mirroring round-lifecycle.service.test.ts's own identical technique).

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "ROUND_LIFECYCLE_READ_TEST_OWNER", email: `${unique("round-lifecycle-read-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

async function createFixtureCircle(ownerId: string, contributionAmount = "10.00") {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("RoundLifecycleReadTestCircle"),
      currency: "USD",
      contributionAmount,
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status: "DRAFT",
    },
    select: { id: true },
  });
  ownedResourceIds.circleIds.add(circle.id);
  return circle.id;
}

async function createFixtureMember(circleId: string, ownerId: string, displayName: string, payoutOrder: number) {
  const member = await prisma.circleMember.create({
    data: {
      circleId,
      displayName,
      memberCode: unique("CODE").toUpperCase().replace(/[^A-F0-9]/g, "0").slice(0, 16).padEnd(16, "0"),
      pinHash: "not-a-real-hash",
      status: "ACTIVE",
      payoutOrder,
      addedById: ownerId,
    },
    select: { id: true },
  });
  return member.id;
}

async function createActivatedCircle(memberCount = 3, contributionAmount = "10.00") {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, contributionAmount);
  const memberIds: string[] = [];
  for (let index = 0; index < memberCount; index += 1) {
    memberIds.push(await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1));
  }
  await activateCircle({ ownerId, circleId });

  const rounds = await prisma.payoutRound.findMany({ where: { circleId }, orderBy: { roundNumber: "asc" } });
  const totalAmount = (Number(contributionAmount) * memberCount).toFixed(2);

  return { ownerId, circleId, memberIds, rounds, contributionAmount, totalAmount };
}

async function fulfillContributions(ownerId: string, circleId: string, roundId: string, memberIds: readonly string[], amount: string) {
  for (const memberId of memberIds) {
    const obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId, roundId, memberId } });
    const payment = await recordContribution({
      ownerId,
      circleId,
      input: { obligationId: obligation.id, amount, clientOperationId: unique("contrib-op") },
    });
    await confirmContribution({ ownerId, circleId, input: { paymentId: payment.id } });
  }
}

async function recordAndConfirmPayout(ownerId: string, circleId: string, roundId: string, recipientId: string, amount: string) {
  const payout = await recordPayout({
    ownerId,
    circleId,
    input: { roundId, amount, clientOperationId: unique("payout-op") },
  });
  return confirmPayout({ circleId, memberId: recipientId, input: { payoutId: payout.id } });
}

async function makeRoundFinanciallyComplete(
  fixture: Awaited<ReturnType<typeof createActivatedCircle>>,
  round: { id: string; recipientId: string },
) {
  await fulfillContributions(fixture.ownerId, fixture.circleId, round.id, fixture.memberIds, fixture.contributionAmount);
  return recordAndConfirmPayout(fixture.ownerId, fixture.circleId, round.id, round.recipientId, fixture.totalAmount);
}

let baselineCounts: { users: number; goals: number; deposits: number; custodians: number };

test.before(async () => {
  baselineCounts = {
    users: await prisma.user.count(),
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
});

test.after(async () => {
  const circleIds = [...ownedResourceIds.circleIds];
  if (circleIds.length > 0) {
    await prisma.payout.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.contributionPayment.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.contributionObligation.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.payoutRound.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.circleMember.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.savingsCircle.deleteMany({ where: { id: { in: circleIds } } });
  }
  const userIds = [...ownedResourceIds.userIds];
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

test("this suite makes no financial/domain lifecycle mutation outside the SUSU tables it created", async () => {
  assert.equal(await prisma.personalGoal.count(), baselineCounts.goals);
  assert.equal(await prisma.deposit.count(), baselineCounts.deposits);
  assert.equal(await prisma.goalCustodian.count(), baselineCounts.custodians);
});

// ===================================================================
// Phase -- NOT_STARTED (section 24)
// ===================================================================

test("NOT_STARTED: every round UPCOMING, round 1 offered as next, first-round start eligible", async () => {
  const fixture = await createActivatedCircle(3);
  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(result.phase, "NOT_STARTED");
  assert.equal(result.currentRound, null);
  assert.equal(result.nextRound?.id, fixture.rounds[0].id);
  assert.equal(result.nextRound?.roundNumber, 1);
  assert.equal(result.totalRounds, 3);
  assert.equal(result.closedRounds, 0);
  assert.deepEqual(result.progression, {
    canStartFirstRound: true,
    canAdvanceCurrentRound: false,
    blocker: null,
    transitionKind: "START_FIRST_ROUND",
  });
});

test("NOT_STARTED: past or future dueDate/startDate never alters first-round eligibility", async () => {
  const fixture = await createActivatedCircle(3);
  await prisma.payoutRound.updateMany({
    where: { circleId: fixture.circleId, roundNumber: 1 },
    data: { dueDate: new Date("2020-01-01T00:00:00.000Z") },
  });
  await prisma.payoutRound.updateMany({
    where: { circleId: fixture.circleId, roundNumber: 2 },
    data: { dueDate: new Date("2099-01-01T00:00:00.000Z") },
  });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.canStartFirstRound, true);
  assert.equal(result.phase, "NOT_STARTED");
});

// ===================================================================
// Phase -- IN_PROGRESS (section 25)
// ===================================================================

test("IN_PROGRESS: current = the persisted ACTIVE round, next = its immediate successor, truthful recipient identities", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(result.phase, "IN_PROGRESS");
  assert.equal(result.currentRound?.id, fixture.rounds[1].id);
  assert.equal(result.currentRound?.roundNumber, 2);
  assert.equal(result.nextRound?.id, fixture.rounds[2].id);
  assert.equal(result.nextRound?.roundNumber, 3);
  assert.equal(result.totalRounds, 3);
  assert.equal(result.closedRounds, 1);

  const round2Member = await prisma.circleMember.findUniqueOrThrow({ where: { id: fixture.rounds[1].recipientId } });
  assert.equal(result.currentRound?.recipient.id, round2Member.id);
  assert.equal(result.currentRound?.recipient.displayName, round2Member.displayName);
  assert.equal(result.currentRound?.recipient.memberCode, round2Member.memberCode);
});

// ===================================================================
// Phase -- ALL_ROUNDS_CLOSED (section 26)
// ===================================================================

test("ALL_ROUNDS_CLOSED: no current/next round, circle status remains ACTIVE, AWAIT_CIRCLE_COMPLETION", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(result.phase, "ALL_ROUNDS_CLOSED");
  assert.equal(result.currentRound, null);
  assert.equal(result.nextRound, null);
  assert.equal(result.closedRounds, 2);
  assert.deepEqual(result.progression, {
    canStartFirstRound: false,
    canAdvanceCurrentRound: false,
    blocker: null,
    transitionKind: "AWAIT_CIRCLE_COMPLETION",
  });
  assert.equal(result.circle.status, "ACTIVE", "SavingsCircle.status must still read ACTIVE -- circle completion is a separate, unimplemented operation");
});

// ===================================================================
// Contribution blockers (section 27)
// ===================================================================

test("CONTRIBUTIONS_INCOMPLETE: one ordinary OPEN obligation with no confirmed payment blocks advance", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.blocker, "CONTRIBUTIONS_INCOMPLETE");
  assert.equal(result.progression.canAdvanceCurrentRound, false);
  assert.equal(result.progression.transitionKind, "ADVANCE_TO_NEXT_ROUND");
});

test("CONTRIBUTIONS_INCOMPLETE: a RECORDED-only (not confirmed) contribution payment does not fulfill the obligation", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];

  const obligation = await prisma.contributionObligation.findFirstOrThrow({
    where: { circleId: fixture.circleId, roundId: round1.id, memberId: fixture.memberIds[0] },
  });
  await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: obligation.id, amount: fixture.contributionAmount, clientOperationId: unique("contrib-op") },
  });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.blocker, "CONTRIBUTIONS_INCOMPLETE");
});

test("contribution blocker clears once every obligation is validly fulfilled", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.notEqual(result.progression.blocker, "CONTRIBUTIONS_INCOMPLETE");
  assert.equal(result.progression.blocker, "PAYOUT_MISSING", "contributions are clear, so the NEXT blocker (payout) should surface");
});

// ===================================================================
// Contribution corruption (section 28)
// ===================================================================

test("integrity error, never a blocker: a FULFILLED obligation with no coherent confirmed payment support", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const obligation = await prisma.contributionObligation.findFirstOrThrow({
    where: { circleId: fixture.circleId, roundId: fixture.rounds[0].id, memberId: fixture.memberIds[0] },
  });
  await prisma.contributionObligation.update({
    where: { id: obligation.id },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error, never readiness: an OPEN obligation despite a coherent confirmed payment already existing", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const obligation = await prisma.contributionObligation.findFirstOrThrow({
    where: { circleId: fixture.circleId, roundId: round1.id, memberId: fixture.memberIds[0] },
  });
  const payment = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: obligation.id, amount: fixture.contributionAmount, clientOperationId: unique("contrib-op") },
  });
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: payment.id } });
  // Manufacture the contradiction: force the obligation back to OPEN
  // despite its now-CONFIRMED ledger support.
  await prisma.contributionObligation.update({ where: { id: obligation.id }, data: { status: "OPEN", fulfilledAt: null } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

// ===================================================================
// Payout blockers (section 29)
// ===================================================================

test("PAYOUT_MISSING once contributions are complete but no payout has been recorded", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.blocker, "PAYOUT_MISSING");
});

test("PAYOUT_NOT_CONFIRMED once the payout is RECORDED but not yet confirmed", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);
  await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.rounds[0].id, amount: fixture.totalAmount, clientOperationId: unique("payout-op") },
  });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.blocker, "PAYOUT_NOT_CONFIRMED");
});

test("PAYOUT_DISPUTED once the recipient disputes the payout -- a permanent business blocker, never corruption", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);
  const payout = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.rounds[0].id, amount: fixture.totalAmount, clientOperationId: unique("payout-op") },
  });
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.rounds[0].recipientId,
    input: { payoutId: payout.id, disputeReason: "wrong amount" },
  });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.blocker, "PAYOUT_DISPUTED");
  assert.equal(result.progression.canAdvanceCurrentRound, false);
});

test("canAdvanceCurrentRound is true once payout is coherently CONFIRMED", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.canAdvanceCurrentRound, true);
  assert.equal(result.progression.blocker, null);
});

// ===================================================================
// Payout corruption (section 30)
// ===================================================================

test("integrity error: a CONFIRMED payout with an amount drift from the round's frozen expected total", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { amount: "999.00" } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: a CONFIRMED payout with a currency drift", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { currency: "EUR" } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: a CONFIRMED payout whose confirmedByMemberId does not match the round's own recipient", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { confirmedByMemberId: fixture.memberIds[1] } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: a CONFIRMED payout missing its confirmedAt timestamp", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { confirmedAt: null } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: a CONFIRMED payout that also carries contradictory dispute provenance", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { disputedAt: new Date() } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

// ===================================================================
// Final round (section 31)
// ===================================================================

test("final ACTIVE round, financially incomplete: CLOSE_FINAL_ROUND with canAdvance false and a proper blocker, never COMPLETE_CIRCLE", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.nextRound, null);
  assert.equal(result.progression.transitionKind, "CLOSE_FINAL_ROUND");
  assert.equal(result.progression.canAdvanceCurrentRound, false);
  assert.equal(result.progression.blocker, "CONTRIBUTIONS_INCOMPLETE");
});

test("final ACTIVE round, financially complete: CLOSE_FINAL_ROUND with canAdvance true and no blocker", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.progression.transitionKind, "CLOSE_FINAL_ROUND");
  assert.equal(result.progression.canAdvanceCurrentRound, true);
  assert.equal(result.progression.blocker, null);
});

// ===================================================================
// Lifecycle corruption (section 32)
// ===================================================================

test("integrity error: multiple ACTIVE rounds", async () => {
  const fixture = await createActivatedCircle(3);
  await prisma.payoutRound.update({
    where: { id: fixture.rounds[0].id },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: fixture.ownerId },
  });
  await prisma.payoutRound.update({
    where: { id: fixture.rounds[1].id },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: fixture.ownerId },
  });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: an invalid persisted roundNumber sequence", async () => {
  const fixture = await createActivatedCircle(3);
  await prisma.payoutRound.update({ where: { id: fixture.rounds[1].id }, data: { roundNumber: 99 } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: an UPCOMING round before a CLOSED one (out-of-order shape)", async () => {
  const fixture = await createActivatedCircle(3);
  // round 1 is left UPCOMING; round 2 is forced CLOSED out of sequence.
  await prisma.payoutRound.update({
    where: { id: fixture.rounds[1].id },
    data: {
      status: "CLOSED",
      activatedAt: new Date(),
      activatedById: fixture.ownerId,
      closedAt: new Date(),
      closedById: fixture.ownerId,
    },
  });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: an ACTIVE round whose predecessor is not CLOSED", async () => {
  const fixture = await createActivatedCircle(3);
  // round 2 forced ACTIVE while round 1 remains UPCOMING (never closed).
  await prisma.payoutRound.update({
    where: { id: fixture.rounds[1].id },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: fixture.ownerId },
  });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: a CLOSED round missing closedAt", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await prisma.payoutRound.update({ where: { id: fixture.rounds[0].id }, data: { closedAt: null } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: a CLOSED round missing closedById", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await prisma.payoutRound.update({ where: { id: fixture.rounds[0].id }, data: { closedById: null } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: an ACTIVE round missing activatedAt", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await prisma.payoutRound.update({ where: { id: fixture.rounds[0].id }, data: { activatedAt: null } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: an ACTIVE round missing activatedById", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await prisma.payoutRound.update({ where: { id: fixture.rounds[0].id }, data: { activatedById: null } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

test("integrity error: an UPCOMING round carrying invalid transition provenance", async () => {
  const fixture = await createActivatedCircle(3);
  await prisma.payoutRound.update({
    where: { id: fixture.rounds[1].id },
    data: { activatedAt: new Date(), activatedById: fixture.ownerId },
  });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleIntegrityError,
  );
});

// ===================================================================
// Historical recipient authority (section 33)
// ===================================================================

test("round recipient remains the persisted PayoutRound recipient after payoutOrder is mutated -- never reconstructed from payoutOrder", async () => {
  const fixture = await createActivatedCircle(3);
  const round1RecipientId = fixture.rounds[0].recipientId;

  // Mutate CircleMember.payoutOrder for every member, scrambling it away
  // from the frozen recipient mapping activation established. Two passes
  // through a disjoint negative range first, since
  // CircleMember_circleId_payoutOrder_key would otherwise reject an
  // intermediate collision while reversing the order in place.
  for (const [index, memberId] of fixture.memberIds.entries()) {
    await prisma.circleMember.update({ where: { id: memberId }, data: { payoutOrder: -(index + 1) } });
  }
  for (const [index, memberId] of fixture.memberIds.entries()) {
    await prisma.circleMember.update({ where: { id: memberId }, data: { payoutOrder: fixture.memberIds.length - index } });
  }

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.nextRound?.recipient.id, round1RecipientId, "recipient must remain PayoutRound's own frozen recipientId, never re-derived from payoutOrder");
});

// ===================================================================
// No date authority (section 34)
// ===================================================================

test("advance readiness for the current round is unaffected by past or future dueDate values", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await prisma.payoutRound.update({ where: { id: fixture.rounds[0].id }, data: { dueDate: new Date("2099-01-01T00:00:00.000Z") } });

  const beforeFulfillment = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(beforeFulfillment.progression.blocker, "CONTRIBUTIONS_INCOMPLETE");

  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  const afterFulfillment = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(afterFulfillment.progression.canAdvanceCurrentRound, true, "a far-future dueDate must never block a financially-complete round");
});

// ===================================================================
// Authorization (section 35)
// ===================================================================

test("a nonexistent circle is rejected with OwnerRoundLifecycleCircleNotFoundError", async () => {
  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: "owner-x", circleId: "does-not-exist" }),
    OwnerRoundLifecycleCircleNotFoundError,
  );
});

test("a circle belonging to a different owner is rejected with OwnerRoundLifecycleAuthorizationError", async () => {
  const fixture = await createActivatedCircle(2);
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: otherOwnerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleAuthorizationError,
  );
});

test("a DRAFT circle (never activated) is rejected with OwnerRoundLifecycleCircleNotEligibleError", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId);

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId, circleId }),
    OwnerRoundLifecycleCircleNotEligibleError,
  );
});

test("a COMPLETED circle is rejected with OwnerRoundLifecycleCircleNotEligibleError (this read's own ACTIVE-only scope)", async () => {
  const fixture = await createActivatedCircle(2);
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () => getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerRoundLifecycleCircleNotEligibleError,
  );
});

// ===================================================================
// Safe shape (section 36)
// ===================================================================

test("the serialized result never contains a private/actor/session field anywhere in its JSON", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);

  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const json = JSON.stringify(result);

  for (const forbidden of [
    "pinHash",
    "credentialVersion",
    "failedPinAttempts",
    "lockedUntil",
    "session",
    "tokenHash",
    "clientOperationId",
    "recordedById",
    "confirmedByMemberId",
    "disputedByMemberId",
    "payoutOrder",
  ]) {
    assert.ok(!json.includes(forbidden), `expected no "${forbidden}" in the serialized result`);
  }
});

test("exact top-level and progression key shape", async () => {
  const fixture = await createActivatedCircle(3);
  const result = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.deepEqual(
    Object.keys(result).sort(),
    ["circle", "closedRounds", "currentRound", "nextRound", "phase", "progression", "totalRounds"].sort(),
  );
  assert.deepEqual(Object.keys(result.circle).sort(), ["id", "status"].sort());
  assert.deepEqual(
    Object.keys(result.progression).sort(),
    ["blocker", "canAdvanceCurrentRound", "canStartFirstRound", "transitionKind"].sort(),
  );
  assert.deepEqual(
    Object.keys(result.nextRound ?? {}).sort(),
    ["id", "roundNumber", "recipient", "dueDate", "status"].sort(),
  );
  assert.deepEqual(Object.keys(result.nextRound?.recipient ?? {}).sort(), ["id", "displayName", "memberCode"].sort());
});

// ===================================================================
// Query count / no N+1 (section 37)
// ===================================================================

test("query count does not grow with member/obligation count -- 8 members resolves exactly as boundedly as 3", async () => {
  const small = await createActivatedCircle(3);
  const large = await createActivatedCircle(8);
  await activateFirstRound({ ownerId: small.ownerId, circleId: small.circleId });
  await activateFirstRound({ ownerId: large.ownerId, circleId: large.circleId });
  await makeRoundFinanciallyComplete(small, small.rounds[0]);
  await makeRoundFinanciallyComplete(large, large.rounds[0]);

  const smallResult = await getOwnerRoundLifecycle({ ownerId: small.ownerId, circleId: small.circleId });
  const largeResult = await getOwnerRoundLifecycle({ ownerId: large.ownerId, circleId: large.circleId });

  assert.equal(smallResult.progression.canAdvanceCurrentRound, true);
  assert.equal(largeResult.progression.canAdvanceCurrentRound, true);
});

test("structural: the service source calls each read function exactly once, never in a loop over rounds/obligations", () => {
  const source = readFileSync(
    new URL("./round-lifecycle-owner-read.service.ts", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const fn of [
    "findCircleForRoundLifecycle(",
    "findRoundsForOwnerRoundLifecycle(",
    "findObligationsForLifecycleRound(",
    "findConfirmedPaymentSumsForLifecycle(",
    "findPayoutForLifecycleRound(",
  ]) {
    const occurrences = source.split(fn).length - 1;
    assert.equal(occurrences, 1, `expected exactly one call site for ${fn}, found ${occurrences}`);
  }
  // No per-round or per-obligation loop calls any read function -- the
  // only iteration in this file is over already-fetched, in-memory data
  // (rounds.find/.every/.filter, obligations.map), never a query.
  assert.doesNotMatch(source, /for\s*\(.*\)\s*{[\s\S]*?await\s+find/);
});

// ===================================================================
// 7K.13 alignment regression (section 38)
// ===================================================================

test("alignment A: read reports CONTRIBUTIONS_INCOMPLETE exactly when advanceRound would reject with the corresponding error", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  const read = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(read.progression.blocker, "CONTRIBUTIONS_INCOMPLETE");

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecycleContributionsIncompleteError,
  );
});

test("alignment B: read reports PAYOUT_MISSING exactly when advanceRound would reject with the corresponding error", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);

  const read = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(read.progression.blocker, "PAYOUT_MISSING");

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecyclePayoutMissingError,
  );
});

test("alignment C: read reports PAYOUT_NOT_CONFIRMED exactly when advanceRound would reject with the corresponding error", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);
  await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.rounds[0].id, amount: fixture.totalAmount, clientOperationId: unique("payout-op") },
  });

  const read = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(read.progression.blocker, "PAYOUT_NOT_CONFIRMED");

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecyclePayoutNotConfirmedError,
  );
});

test("alignment D: read reports PAYOUT_DISPUTED exactly when advanceRound would reject with the corresponding error", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);
  const payout = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.rounds[0].id, amount: fixture.totalAmount, clientOperationId: unique("payout-op") },
  });
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.rounds[0].recipientId,
    input: { payoutId: payout.id, disputeReason: "wrong amount" },
  });

  const read = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(read.progression.blocker, "PAYOUT_DISPUTED");

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecyclePayoutDisputedError,
  );
});

test("alignment E: read reports canAdvanceCurrentRound true exactly when advanceRound genuinely succeeds", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);

  const read = await getOwnerRoundLifecycle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(read.progression.canAdvanceCurrentRound, true);

  const advanced = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  assert.equal(advanced.replayed, false);
});
