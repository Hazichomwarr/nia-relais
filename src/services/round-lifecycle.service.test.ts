import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";
import { activateCircle, CircleActivationIntegrityError } from "@/src/services/circle.service";
import { confirmContribution } from "@/src/services/contribution-confirmation.service";
import { recordContribution } from "@/src/services/contribution-recording.service";
import { confirmPayout } from "@/src/services/payout-confirmation.service";
import { disputePayout } from "@/src/services/payout-dispute.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import {
  activateFirstRound,
  advanceRound,
  RoundLifecycleAuthorizationError,
  RoundLifecycleCircleNotActiveError,
  RoundLifecycleCircleNotFoundError,
  RoundLifecycleContributionsIncompleteError,
  RoundLifecycleIntegrityError,
  RoundLifecycleNotCurrentError,
  RoundLifecyclePayoutDisputedError,
  RoundLifecyclePayoutMissingError,
  RoundLifecyclePayoutNotConfirmedError,
  RoundLifecycleRoundNotFoundError,
} from "@/src/services/round-lifecycle.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests for the round-lifecycle services (7K.13),
// implementing the frozen 7K.11 contract. Same methodology as every
// prior SUSU ticket: unique-id-scoped fixtures, FK-ordered cleanup in
// test.after regardless of outcome, before/after row counts on unrelated
// domain tables. No TEST_DATABASE_URL required. Fixtures use the real,
// already-shipped recordContribution/confirmContribution/recordPayout/
// confirmPayout/disputePayout/activateCircle services throughout -- never
// hand-inserted financial rows -- so every fixture starts from
// persistence those services would actually produce.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

/**
 * Asserts two lifecycle results describe the identical persisted
 * transition (same rounds, same provenance, same timestamps) while
 * deliberately ignoring the `replayed` flag itself -- a fresh transition
 * and its own subsequent replay (or two concurrent callers where one
 * wins fresh and the other observes it as a replay) are expected to
 * differ in `replayed` alone; everything else must be byte-identical.
 */
function assertSameTransition<T extends { replayed: boolean }>(actual: T, expected: T) {
  assert.deepEqual({ ...actual, replayed: undefined }, { ...expected, replayed: undefined });
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "ROUND_LIFECYCLE_TEST_OWNER", email: `${unique("round-lifecycle-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

async function createFixtureCircle(ownerId: string, contributionAmount = "10.00") {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("RoundLifecycleTestCircle"),
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

/**
 * A genuinely activated circle: DRAFT -> members added with a complete
 * payout order -> activateCircle (real service, no fingerprint needed).
 * Every round is created UPCOMING, every obligation OPEN, exactly as
 * activateCircle itself already guarantees -- this helper performs no
 * lifecycle progression of its own.
 */
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

/** Records and confirms every member's contribution for one round. */
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

/** Records and confirms the round's payout, returning the confirmed payout row. */
async function recordAndConfirmPayout(ownerId: string, circleId: string, roundId: string, recipientId: string, amount: string) {
  const payout = await recordPayout({
    ownerId,
    circleId,
    input: { roundId, amount, clientOperationId: unique("payout-op") },
  });
  return confirmPayout({ circleId, memberId: recipientId, input: { payoutId: payout.id } });
}

/** Fulfills every financial precondition for closing one round: every
 * contribution confirmed, payout recorded and confirmed. */
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

// ===================================================================
// activateFirstRound
// ===================================================================

test("the owner activates round 1: it becomes ACTIVE with provenance, later rounds remain UPCOMING", async () => {
  const fixture = await createActivatedCircle(3);
  const before = new Date();

  const result = await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(result.replayed, false);
  assert.equal(result.round.roundNumber, 1);
  assert.equal(result.round.status, "ACTIVE");
  assert.equal(result.round.activatedById, fixture.ownerId);
  assert.equal(result.round.closedAt, null);
  assert.equal(result.round.closedById, null);
  assert.ok(new Date(result.round.activatedAt).getTime() >= before.getTime() - 1000);

  const rounds = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } });
  assert.equal(rounds[0].status, "ACTIVE");
  assert.equal(rounds[1].status, "UPCOMING");
  assert.equal(rounds[2].status, "UPCOMING");
  assert.equal(rounds[1].activatedAt, null);
});

test("a wrong owner is denied, and round 1 remains UPCOMING", async () => {
  const fixture = await createActivatedCircle(2);
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () => activateFirstRound({ ownerId: otherOwnerId, circleId: fixture.circleId }),
    RoundLifecycleAuthorizationError,
  );
  const round1 = await prisma.payoutRound.findFirstOrThrow({ where: { circleId: fixture.circleId, roundNumber: 1 } });
  assert.equal(round1.status, "UPCOMING");
});

test("a nonexistent circle is rejected as not found", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => activateFirstRound({ ownerId, circleId: "does-not-exist" }),
    RoundLifecycleCircleNotFoundError,
  );
});

test("a DRAFT circle (never activated, no rounds yet) is rejected as not-active, not as corruption", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId);
  await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureMember(circleId, ownerId, "B", 2);

  await assert.rejects(
    () => activateFirstRound({ ownerId, circleId }),
    RoundLifecycleCircleNotActiveError,
  );
});

for (const status of ["COMPLETED", "ARCHIVED"] as const) {
  test(`a fresh activateFirstRound is rejected once the circle is ${status}`, async () => {
    const fixture = await createActivatedCircle(2);
    await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status } });

    await assert.rejects(
      () => activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
      RoundLifecycleCircleNotActiveError,
    );
  });
}

test("dueDate and startDate do not gate activation -- a due date far in the past or future is irrelevant", async () => {
  const ownerId = await createOwner();
  const circleId = await prisma.savingsCircle
    .create({
      data: {
        ownerId,
        name: unique("FutureStartCircle"),
        currency: "USD",
        contributionAmount: "10.00",
        frequency: "WEEKLY",
        startDate: new Date("2099-01-01T00:00:00.000Z"),
        status: "DRAFT",
      },
      select: { id: true },
    })
    .then((circle) => {
      ownedResourceIds.circleIds.add(circle.id);
      return circle.id;
    });
  await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureMember(circleId, ownerId, "B", 2);
  await activateCircle({ ownerId, circleId });

  const result = await activateFirstRound({ ownerId, circleId });
  assert.equal(result.round.status, "ACTIVE");
});

test("an exact replay of an already-ACTIVE round 1 performs zero writes and reports the true persisted state", async () => {
  const fixture = await createActivatedCircle(2);
  const first = await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const before = await prisma.payoutRound.findFirstOrThrow({ where: { circleId: fixture.circleId, roundNumber: 1 } });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const after = await prisma.payoutRound.findFirstOrThrow({ where: { circleId: fixture.circleId, roundNumber: 1 } });

  assertSameTransition(second, first);
  assert.equal(second.replayed, true);
  assert.equal(after.activatedAt?.getTime(), before.activatedAt?.getTime());
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "a replay must not write the row at all");
});

test("replay after round 1 has since been CLOSED remains coherent and reports the true CLOSED status", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  await makeRoundFinanciallyComplete(fixture, round1);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id });

  const replay = await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(replay.replayed, true);
  assert.equal(replay.round.status, "CLOSED", "must report the truthful current status, not a stale ACTIVE");
});

test("multiple-ACTIVE corruption is rejected as an integrity error", async () => {
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
    () => activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    RoundLifecycleIntegrityError,
  );
});

// ===================================================================
// advanceRound -- non-final round
// ===================================================================

test("closes a financially-complete non-final round and atomically activates its successor", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  await makeRoundFinanciallyComplete(fixture, round1);
  const before = new Date();

  const result = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id });

  assert.equal(result.replayed, false);
  assert.equal(result.isFinalRound, false);
  assert.equal(result.closedRound.status, "CLOSED");
  assert.equal(result.closedRound.closedById, fixture.ownerId);
  assert.ok(new Date(result.closedRound.closedAt!).getTime() >= before.getTime() - 1000);
  assert.ok(result.activatedRound);
  assert.equal(result.activatedRound?.status, "ACTIVE");
  assert.equal(result.activatedRound?.roundNumber, 2);
  assert.equal(result.activatedRound?.activatedById, fixture.ownerId);

  const persisted = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } });
  assert.equal(persisted[0].status, "CLOSED");
  assert.equal(persisted[1].status, "ACTIVE");
  assert.equal(persisted[2].status, "UPCOMING");
});

test("closedAt and the successor's activatedAt share the exact same transition timestamp", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  await makeRoundFinanciallyComplete(fixture, round1);

  const result = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id });
  assert.equal(result.closedRound.closedAt, result.activatedRound?.activatedAt);
});

test("advancing an UPCOMING round directly (never ACTIVE) is rejected -- no skipping", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[2].id }),
    RoundLifecycleNotCurrentError,
  );
});

test("advancing a round before round 1 has ever been activated is rejected", async () => {
  const fixture = await createActivatedCircle(2);
  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecycleNotCurrentError,
  );
});

test("a wrong owner is denied", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () => advanceRound({ ownerId: otherOwnerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecycleAuthorizationError,
  );
});

test("a foreign roundId (belonging to a different circle) collapses to the same not-found outcome", async () => {
  const fixtureA = await createActivatedCircle(2);
  const fixtureB = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixtureB.ownerId, circleId: fixtureB.circleId });

  await assert.rejects(
    () => advanceRound({ ownerId: fixtureB.ownerId, circleId: fixtureB.circleId, roundId: fixtureA.rounds[0].id }),
    RoundLifecycleRoundNotFoundError,
  );
});

// ===================================================================
// advanceRound -- final round
// ===================================================================

test("closes the final round with no successor activation, leaving the circle ACTIVE with every round CLOSED", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);
  const result = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id });

  assert.equal(result.isFinalRound, true);
  assert.equal(result.activatedRound, null);
  assert.equal(result.closedRound.status, "CLOSED");

  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE", "final round closure must never complete the circle");
  assert.equal(circle.completedAt, null);
  assert.equal(circle.completedById, null);

  const rounds = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId } });
  assert.ok(rounds.every((round) => round.status === "CLOSED"), "every round CLOSED is a legitimate pre-completion state");
});

// ===================================================================
// advanceRound -- financial readiness (not-ready vs integrity)
// ===================================================================

test("an OPEN obligation blocks advancement with a specific, safe error -- not integrity", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecycleContributionsIncompleteError,
  );
  const round1 = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[0].id } });
  assert.equal(round1.status, "ACTIVE");
});

test("historical REJECTED attempt alongside one valid CONFIRMED attempt is closable", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];

  const [memberA, memberB] = fixture.memberIds;
  const obligationA = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id, memberId: memberA } });
  const rejected = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { obligationId: obligationA.id, amount: fixture.contributionAmount, clientOperationId: unique("op-a1") } });
  const { rejectContribution } = await import("@/src/services/contribution-rejection.service");
  await rejectContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: rejected.id, rejectionReason: "wrong amount" } });
  const confirmed = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { obligationId: obligationA.id, amount: fixture.contributionAmount, clientOperationId: unique("op-a2") } });
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: confirmed.id } });

  const obligationB = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id, memberId: memberB } });
  const paymentB = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { obligationId: obligationB.id, amount: fixture.contributionAmount, clientOperationId: unique("op-b") } });
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: paymentB.id } });

  await recordAndConfirmPayout(fixture.ownerId, fixture.circleId, round1.id, round1.recipientId, fixture.totalAmount);

  const result = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id });
  assert.equal(result.closedRound.status, "CLOSED");
});

test("no payout at all blocks advancement", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecyclePayoutMissingError,
  );
});

test("a RECORDED (not yet confirmed) payout blocks advancement", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[0].id, fixture.memberIds, fixture.contributionAmount);
  await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { roundId: fixture.rounds[0].id, amount: fixture.totalAmount, clientOperationId: unique("op") } });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecyclePayoutNotConfirmedError,
  );
});

test("a DISPUTED payout permanently blocks advancement -- terminal in V1", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  await fulfillContributions(fixture.ownerId, fixture.circleId, round1.id, fixture.memberIds, fixture.contributionAmount);
  const payout = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { roundId: round1.id, amount: fixture.totalAmount, clientOperationId: unique("op") } });
  await disputePayout({ circleId: fixture.circleId, memberId: round1.recipientId, input: { payoutId: payout.id, disputeReason: "not received" } });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecyclePayoutDisputedError,
  );
  // Permanently -- a second attempt still fails identically, and round 2 never activates.
  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecyclePayoutDisputedError,
  );
  const round2 = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[1].id } });
  assert.equal(round2.status, "UPCOMING", "a dispute in round N permanently prevents round N+1 from activating");
});

// ===================================================================
// advanceRound -- financial integrity (corruption, never "not ready")
// ===================================================================

test("a CONFIRMED payout with an amount that no longer matches frozen obligations is an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, round1);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { amount: "999.00" } });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecycleIntegrityError,
  );
});

test("a CONFIRMED payout with a currency that no longer matches frozen obligations is an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, round1);
  await prisma.payout.update({ where: { id: confirmedPayout.id }, data: { currency: "EUR" } });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecycleIntegrityError,
  );
});

test("a CONFIRMED payout whose confirmedByMemberId does not match the persisted recipient is an integrity error", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, round1);
  const otherMemberId = fixture.memberIds.find((id) => id !== round1.recipientId)!;
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedByMemberId" = ${otherMemberId} WHERE "id" = ${confirmedPayout.id}`;

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecycleIntegrityError,
  );
});

test("a CONFIRMED payout carrying contradictory dispute provenance is an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const confirmedPayout = await makeRoundFinanciallyComplete(fixture, round1);
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${round1.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${confirmedPayout.id}`;

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecycleIntegrityError,
  );
});

test("a FULFILLED obligation with no confirmed ledger support is an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id } });
  await prisma.contributionObligation.update({ where: { id: obligation.id }, data: { status: "FULFILLED", fulfilledAt: new Date() } });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    RoundLifecycleIntegrityError,
  );
});

test("obligations disagreeing on currency surface the domain's own accounting integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  const obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id } });
  await prisma.contributionObligation.update({ where: { id: obligation.id }, data: { currency: "EUR" } });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
    PayoutAccountingIntegrityError,
  );
});

// ===================================================================
// advanceRound -- replay
// ===================================================================

test("replaying advanceRound on an already-CLOSED non-final round performs zero writes", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  const first = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  const before = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[0].id } });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  const after = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[0].id } });

  assertSameTransition(second, first);
  assert.equal(second.replayed, true);
  assert.equal(after.closedAt?.getTime(), before.closedAt?.getTime());
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "a replay must not write the row at all");
});

test("stale replay after progression has continued further (successor also CLOSED) remains coherent", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id });

  // Stale replay of round 1's own long-past transition, even though
  // round 2 has since ALSO closed and round 3 is now the current one.
  const replay = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  assert.equal(replay.replayed, true);
  assert.equal(replay.closedRound.status, "CLOSED");
  assert.equal(replay.activatedRound?.status, "CLOSED", "the successor is reported truthfully, even though it has since progressed past ACTIVE");
});

test("replaying the final round's closure performs zero writes", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);
  const first = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id });

  const second = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id });
  assertSameTransition(second, first);
  assert.equal(second.isFinalRound, true);
  assert.equal(second.activatedRound, null);
});

test("a replay survives the circle later becoming COMPLETED/ARCHIVED", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  const first = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "ARCHIVED" } });
  const replay = await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  assertSameTransition(replay, first);
});

// ===================================================================
// Lifecycle integrity (manufactured corruption)
// ===================================================================

test("a gap in round numbers is rejected as an integrity error", async () => {
  const fixture = await createActivatedCircle(3);
  await prisma.payoutRound.update({ where: { id: fixture.rounds[1].id }, data: { roundNumber: 99 } });

  await assert.rejects(
    () => activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    RoundLifecycleIntegrityError,
  );
});

test("an out-of-order structure (ACTIVE with an earlier UPCOMING round) is rejected", async () => {
  const fixture = await createActivatedCircle(3);
  await prisma.payoutRound.update({
    where: { id: fixture.rounds[1].id },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: fixture.ownerId },
  });

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id }),
    RoundLifecycleIntegrityError,
  );
});

test("a CLOSED round missing closedById is rejected as an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await prisma.$executeRaw`UPDATE "PayoutRound" SET "status" = 'CLOSED', "activatedAt" = now(), "activatedById" = ${fixture.ownerId}, "closedAt" = now(), "closedById" = NULL WHERE "id" = ${fixture.rounds[0].id}`;

  await assert.rejects(
    () => activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    RoundLifecycleIntegrityError,
  );
});

test("an ACTIVE round missing activatedById is rejected as an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await prisma.$executeRaw`UPDATE "PayoutRound" SET "status" = 'ACTIVE', "activatedAt" = now(), "activatedById" = NULL WHERE "id" = ${fixture.rounds[0].id}`;

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecycleIntegrityError,
  );
});

test("a successor stuck UPCOMING behind an already-CLOSED current round is an integrity error on replay", async () => {
  const fixture = await createActivatedCircle(3);
  // Manufacture: round 1 CLOSED, but round 2 never activated (contradicts
  // this service's own atomicity guarantee -- unreachable via the real
  // service, constructed directly to test the replay-vs-integrity
  // distinction).
  await prisma.$executeRaw`UPDATE "PayoutRound" SET "status" = 'CLOSED', "activatedAt" = now(), "activatedById" = ${fixture.ownerId}, "closedAt" = now(), "closedById" = ${fixture.ownerId} WHERE "id" = ${fixture.rounds[0].id}`;

  await assert.rejects(
    () => advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    RoundLifecycleIntegrityError,
  );
});

test("no auto-repair -- a corrupted row is left exactly as found after a rejected attempt", async () => {
  const fixture = await createActivatedCircle(2);
  await prisma.payoutRound.update({ where: { id: fixture.rounds[1].id }, data: { roundNumber: 99 } });

  await assert.rejects(() => activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }));

  const persisted = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[1].id } });
  assert.equal(persisted.roundNumber, 99, "the corrupted row must never be silently repaired");
});

// ===================================================================
// activateCircle replay compatibility (7K.13 section 7/34) -- critical
// cross-feature regression
// ===================================================================

test("activateCircle replay succeeds after round-lifecycle progression, without resetting anything", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  const roundsBefore = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } });
  const obligationsBefore = await prisma.contributionObligation.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });

  const replay = await activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(replay.circle.status, "ACTIVE");

  const roundsAfter = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } });
  const obligationsAfter = await prisma.contributionObligation.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });

  assert.deepEqual(roundsAfter, roundsBefore, "activateCircle replay must not touch any round row");
  assert.deepEqual(obligationsAfter, obligationsBefore, "activateCircle replay must not touch any obligation row");
  assert.equal(roundsAfter[0].status, "CLOSED");
  assert.equal(roundsAfter[1].status, "ACTIVE");

  // The replay's own returned round-status list must be truthful, not a
  // hard-coded "UPCOMING" for every round (the bug this ticket's own
  // audit found and fixed).
  assert.equal(replay.rounds[0].status, "CLOSED");
  assert.equal(replay.rounds[1].status, "ACTIVE");
});

test("activateCircle replay does not throw CircleActivationIntegrityError merely because a round has legitimately progressed", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  await assert.doesNotReject(() => activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }));
});

test("activateCircle replay still rejects genuine structural corruption (unrelated to lifecycle progression)", async () => {
  const fixture = await createActivatedCircle(2);
  await prisma.contributionObligation.updateMany({ where: { circleId: fixture.circleId }, data: { expectedAmount: "999.00" } });

  await assert.rejects(
    () => activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleActivationIntegrityError,
  );
});

// ===================================================================
// Contribution / payout non-regression (7K.13 section 32/33)
// ===================================================================

test("late contribution recording for a CLOSED round's own obligations remains impossible only because the obligation is already FULFILLED -- never because of round.status", async () => {
  // This proves the NEGATIVE: recordContribution never inspects
  // round.status at all (structural, see the dedicated source test
  // below) -- the only reason a fresh recording against a CLOSED round's
  // obligation is rejected is the obligation's own already-FULFILLED
  // state, exactly the same rule that already applied before any
  // lifecycle writer existed.
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  // Round 2 is now ACTIVE. A late contribution against round 1's own
  // (already-fulfilled) obligation is still evaluated purely on the
  // obligation's own state -- recordContribution has no gate for it.
  const obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: fixture.rounds[0].id } });
  assert.equal(obligation.status, "FULFILLED");

  // A contribution against round 2 (the new ACTIVE round) succeeds
  // exactly as it always would -- proving round advancement did not
  // silently gate or unlock anything about contribution recording.
  const round2Obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: fixture.rounds[1].id, memberId: fixture.memberIds[0] } });
  const payment = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: round2Obligation.id, amount: fixture.contributionAmount, clientOperationId: unique("op") },
  });
  assert.equal(payment.status, "RECORDED");
});

test("payout recording/confirmation for the new current round remains governed only by 7K rules, never round.status", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  // Round 2 is ACTIVE; recordPayout succeeds against it exactly as
  // payout-recording.service.ts's own frozen contract already promises,
  // with no dependency on round-lifecycle.service.ts having ever run.
  await fulfillContributions(fixture.ownerId, fixture.circleId, fixture.rounds[1].id, fixture.memberIds, fixture.contributionAmount);
  const payout = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.rounds[1].id, amount: fixture.totalAmount, clientOperationId: unique("op") },
  });
  assert.equal(payout.status, "RECORDED");
});

test("recordContribution/confirmContribution/rejectContribution/recordPayout/confirmPayout/disputePayout source contains no reference to PayoutRound.status", async () => {
  const modules = [
    "../services/contribution-recording.service.ts",
    "../services/contribution-confirmation.service.ts",
    "../services/contribution-rejection.service.ts",
    "../services/payout-recording.service.ts",
    "../services/payout-confirmation.service.ts",
    "../services/payout-dispute.service.ts",
  ];
  for (const relativePath of modules) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(source, /round\.status/, `expected no round.status reference in ${relativePath}`);
    assert.doesNotMatch(source, /roundStatus/, `expected no roundStatus reference in ${relativePath}`);
  }
});

// ===================================================================
// No hidden side effects (7K.13 section 39)
// ===================================================================

test("round-lifecycle.service.ts writes no ContributionPayment, ContributionObligation, Payout, CircleMember, or SavingsCircle field", () => {
  const source = readFileSync(new URL("./round-lifecycle.service.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of [
    "contributionPayment.update",
    "contributionPayment.create",
    "contributionObligation.update",
    "contributionObligation.create",
    "payout.update",
    "payout.create",
    "circleMember.update",
    "savingsCircle.update",
    "completedAt",
    "completedById",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("advanceRound and activateFirstRound never write outside PayoutRound", async () => {
  const fixture = await createActivatedCircle(2);
  const paymentCountBefore = await prisma.contributionPayment.count();
  const obligationsBefore = await prisma.contributionObligation.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });
  const membersBefore = await prisma.circleMember.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });
  const circleBefore = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });

  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(await prisma.contributionPayment.count(), paymentCountBefore);
  assert.deepEqual(await prisma.contributionObligation.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } }), obligationsBefore);
  assert.deepEqual(await prisma.circleMember.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } }), membersBefore);
  assert.deepEqual(await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } }), circleBefore);
});

test("no member-session identity dependency, and no owner form input beyond ownerId/circleId/roundId", () => {
  const source = readFileSync(new URL("./round-lifecycle.service.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /memberId/);
});

// ===================================================================
// Lock ordering (7K.13 section 25)
// ===================================================================

test("both public operations acquire the shared SavingsCircle lock via the unmodified lockSavingsCircleForUpdate primitive", () => {
  const source = readFileSync(new URL("./round-lifecycle.service.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(source, /import \{ lockSavingsCircleForUpdate \} from "@\/src\/repositories\/circle-lock\.repository";/);
  const activateFirstRoundOccurrences = source.match(/lockSavingsCircleForUpdate\(/g) ?? [];
  assert.ok(activateFirstRoundOccurrences.length >= 2, "expected both activateFirstRound and advanceRound to call the shared lock");
  assert.doesNotMatch(source, /payoutRound\.findUnique[\s\S]*FOR UPDATE/i);
  assert.doesNotMatch(source, /\$queryRaw/);
});

// ===================================================================
// Concurrency (real Postgres)
// ===================================================================

test("two concurrent activateFirstRound calls resolve to exactly one physical transition", async () => {
  const fixture = await createActivatedCircle(3);

  const results = await Promise.allSettled([
    activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent calls must resolve safely");
  }
  const values = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  assertSameTransition(values[0]!, values[1]!);

  const round1 = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[0].id } });
  assert.equal(round1.status, "ACTIVE");
  const activeCount = await prisma.payoutRound.count({ where: { circleId: fixture.circleId, status: "ACTIVE" } });
  assert.equal(activeCount, 1, "exactly one ACTIVE round must exist afterward");
});

test("two concurrent advanceRound calls on the same financially-complete round resolve to exactly one physical close+activate", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);

  const results = await Promise.allSettled([
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent calls must resolve safely");
  }
  const values = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  assertSameTransition(values[0]!, values[1]!);

  const rounds = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } });
  assert.equal(rounds[0].status, "CLOSED");
  assert.equal(rounds[1].status, "ACTIVE");
  assert.equal(rounds[2].status, "UPCOMING");
});

test("two concurrent advanceRound calls on the final round resolve to exactly one physical close, no successor", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);

  const results = await Promise.allSettled([
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id }),
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id }),
  ]);

  for (const result of results) assert.equal(result.status, "fulfilled");
  const values = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  assertSameTransition(values[0]!, values[1]!);
  assert.equal(values[0]?.isFinalRound, true);

  const round2 = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[1].id } });
  assert.equal(round2.status, "CLOSED");
});

test("advanceRound racing a late contribution confirmation resolves safely either way, never with stale-based success", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];

  // Fulfill every obligation but one, and record (not confirm) the last.
  const [memberA, memberB] = fixture.memberIds;
  await fulfillContributions(fixture.ownerId, fixture.circleId, round1.id, [memberA], fixture.contributionAmount);
  const lastObligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id, memberId: memberB } });
  const lastPayment = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { obligationId: lastObligation.id, amount: fixture.contributionAmount, clientOperationId: unique("op") } });
  await recordAndConfirmPayout(fixture.ownerId, fixture.circleId, round1.id, round1.recipientId, fixture.totalAmount);

  const results = await Promise.allSettled([
    confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: lastPayment.id } }),
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
  ]);

  const confirmOutcome = results[0];
  const advanceOutcome = results[1];
  assert.equal(confirmOutcome.status, "fulfilled", "the confirmation itself must always succeed regardless of race order");

  const round1After = await prisma.payoutRound.findUniqueOrThrow({ where: { id: round1.id } });
  if (advanceOutcome.status === "fulfilled") {
    // advance acquired the lock AFTER the confirmation committed --
    // legitimately closable by then.
    assert.equal(round1After.status, "CLOSED");
  } else {
    // advance acquired the lock BEFORE the confirmation committed --
    // failed safely on the still-incomplete predicate.
    assert.ok(advanceOutcome.reason instanceof RoundLifecycleContributionsIncompleteError);
    assert.equal(round1After.status, "ACTIVE");
  }
});

test("advanceRound racing a payout confirmation resolves safely either way", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  await fulfillContributions(fixture.ownerId, fixture.circleId, round1.id, fixture.memberIds, fixture.contributionAmount);
  const payout = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { roundId: round1.id, amount: fixture.totalAmount, clientOperationId: unique("op") } });

  const results = await Promise.allSettled([
    confirmPayout({ circleId: fixture.circleId, memberId: round1.recipientId, input: { payoutId: payout.id } }),
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
  ]);

  assert.equal(results[0].status, "fulfilled", "the payout confirmation itself must always succeed regardless of race order");
  const round1After = await prisma.payoutRound.findUniqueOrThrow({ where: { id: round1.id } });
  const advanceOutcome = results[1];
  if (advanceOutcome.status === "fulfilled") {
    assert.equal(round1After.status, "CLOSED");
  } else {
    assert.ok(advanceOutcome.reason instanceof RoundLifecyclePayoutNotConfirmedError);
    assert.equal(round1After.status, "ACTIVE");
  }
});

test("advanceRound never succeeds when racing a payout dispute -- the payout was never CONFIRMED before either contender began", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round1 = fixture.rounds[0];
  await fulfillContributions(fixture.ownerId, fixture.circleId, round1.id, fixture.memberIds, fixture.contributionAmount);
  const payout = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { roundId: round1.id, amount: fixture.totalAmount, clientOperationId: unique("op") } });

  const results = await Promise.allSettled([
    disputePayout({ circleId: fixture.circleId, memberId: round1.recipientId, input: { payoutId: payout.id, disputeReason: "not received" } }),
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round1.id }),
  ]);

  assert.equal(results[0].status, "fulfilled", "the dispute itself must always succeed regardless of race order");
  assert.equal(results[1].status, "rejected", "advance must never succeed -- the payout was RECORDED, not CONFIRMED, at the start of this race");

  const round1After = await prisma.payoutRound.findUniqueOrThrow({ where: { id: round1.id } });
  assert.equal(round1After.status, "ACTIVE", "the round must remain ACTIVE -- it can never close against a payout that was never confirmed");
  const round2After = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[1].id } });
  assert.equal(round2After.status, "UPCOMING");
});

test("advanceRound for one round does not interfere with a legitimate late financial writer for a DIFFERENT round", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);

  // A late (but legitimate, per 7J's own frozen rules) contribution
  // recording against round 2's own obligation, racing the round-1
  // advance -- both serialize through the SAME lock, but neither should
  // prevent the other's own legitimate, independent success.
  const round2Obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: fixture.rounds[1].id, memberId: fixture.memberIds[0] } });

  const results = await Promise.allSettled([
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id }),
    recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { obligationId: round2Obligation.id, amount: fixture.contributionAmount, clientOperationId: unique("op") } }),
  ]);

  assert.equal(results[0].status, "fulfilled", "advancing round 1 must succeed");
  assert.equal(results[1].status, "fulfilled", "the unrelated round-2 contribution must also succeed");
});

test("this suite makes no financial/domain lifecycle mutation outside the SUSU tables it created", async () => {
  const finalCounts = {
    users: (await prisma.user.count()) - ownedResourceIds.userIds.size,
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});
