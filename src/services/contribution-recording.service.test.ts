import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ContributionAmountMismatchError,
  ContributionObligationAlreadyFulfilledError,
  ContributionObligationAlreadyRecordedError,
  ContributionObligationNotFoundError,
  ContributionOperationConflictError,
  ContributionRecordingAuthorizationError,
  ContributionRecordingCircleNotActiveError,
  InvalidContributionAmountError,
  recordContribution,
} from "@/src/services/contribution-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket (circle-activation-guard.test.ts, circle-member-dashboard
// .service.test.ts): unique-id-scoped fixtures, FK-ordered cleanup in
// test.after regardless of outcome, before/after row counts on unrelated
// domain tables. No TEST_DATABASE_URL required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "RECORDING_TEST_OWNER", email: `${unique("recording-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";
type RoundStatus = "UPCOMING" | "ACTIVE" | "CLOSED";

async function createFixtureCircle(ownerId: string, status: CircleStatus, contributionAmount: string) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("RecordingTestCircle"),
      currency: "USD",
      contributionAmount,
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
      activatedAt: status === "ACTIVE" ? new Date("2026-01-01T00:00:00.000Z") : null,
      activatedById: status === "ACTIVE" ? ownerId : null,
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

async function createFixtureRound(
  circleId: string,
  input: { roundNumber: number; recipientId: string; dueDate: Date; status: RoundStatus },
) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: input.dueDate,
      status: input.status,
    },
    select: { id: true },
  });
  return round.id;
}

async function createFixtureObligation(
  circleId: string,
  roundId: string,
  memberId: string,
  input: { expectedAmount: string; dueDate: Date },
) {
  const obligation = await prisma.contributionObligation.create({
    data: {
      circleId,
      roundId,
      memberId,
      expectedAmount: input.expectedAmount,
      currency: "USD",
      dueDate: input.dueDate,
      status: "OPEN",
    },
    select: { id: true },
  });
  return obligation.id;
}

/** A ready-to-record ACTIVE circle: one owner, one member, one UPCOMING
 * round, one OPEN obligation for expectedAmount. */
async function createActiveCircleWithObligation(expectedAmount = "25.00", roundStatus: RoundStatus = "UPCOMING") {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", expectedAmount);
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, {
    roundNumber: 1,
    recipientId: memberId,
    dueDate: new Date("2026-01-08T00:00:00.000Z"),
    status: roundStatus,
  });
  const obligationId = await createFixtureObligation(circleId, roundId, memberId, {
    expectedAmount,
    dueDate: new Date("2026-01-08T00:00:00.000Z"),
  });
  return { ownerId, circleId, memberId, roundId, obligationId };
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

test("a valid exact-amount recording succeeds and creates exactly one RECORDED payment", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const result = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
  });

  assert.equal(result.status, "RECORDED");
  assert.equal(result.amount, "25.00");
  assert.equal(result.obligationId, fixture.obligationId);
  assert.equal(result.circleId, fixture.circleId);
  assert.equal(result.recordedById, fixture.ownerId);

  const count = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(count, 1);
});

test("recording as a non-owner is rejected with ContributionRecordingAuthorizationError", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () =>
      recordContribution({
        ownerId: otherOwnerId,
        circleId: fixture.circleId,
        input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
      }),
    ContributionRecordingAuthorizationError,
  );
});

test("a foreign obligation (belonging to a different circle) is rejected as not found", async () => {
  const fixtureA = await createActiveCircleWithObligation("25.00");
  const fixtureB = await createActiveCircleWithObligation("25.00");

  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixtureB.ownerId,
        circleId: fixtureB.circleId,
        input: { obligationId: fixtureA.obligationId, amount: "25.00", clientOperationId: unique("op") },
      }),
    ContributionObligationNotFoundError,
  );
});

test("a non-ACTIVE circle rejects a fresh recording attempt", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
      }),
    ContributionRecordingCircleNotActiveError,
  );
});

test("recording succeeds regardless of round status -- UPCOMING, ACTIVE, and CLOSED are all eligible", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  // PayoutRound has @@unique([circleId, recipientId]) -- each of the 3
  // rounds below needs its own distinct recipient, separate from the
  // contributing member (memberId) this test actually records against.
  const recipients = [
    await createFixtureMember(circleId, ownerId, "R1", 2),
    await createFixtureMember(circleId, ownerId, "R2", 3),
    await createFixtureMember(circleId, ownerId, "R3", 4),
  ];

  for (const [index, status] of (["UPCOMING", "ACTIVE", "CLOSED"] as const).entries()) {
    const roundId = await createFixtureRound(circleId, {
      roundNumber: index + 1,
      recipientId: recipients[index],
      dueDate: new Date("2026-01-08T00:00:00.000Z"),
      status,
    });
    const obligationId = await createFixtureObligation(circleId, roundId, memberId, {
      expectedAmount: "10.00",
      dueDate: new Date("2026-01-08T00:00:00.000Z"),
    });

    const result = await recordContribution({
      ownerId,
      circleId,
      input: { obligationId, amount: "10.00", clientOperationId: unique(`op-${status}`) },
    });
    assert.equal(result.status, "RECORDED", `expected recording to succeed for a ${status} round`);
  }
});

test("recording succeeds against a badly overdue obligation -- due dates neither authorize nor prohibit recording", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, {
    roundNumber: 1,
    recipientId: memberId,
    dueDate: new Date("2020-01-01T00:00:00.000Z"),
    status: "UPCOMING",
  });
  const obligationId = await createFixtureObligation(circleId, roundId, memberId, {
    expectedAmount: "10.00",
    dueDate: new Date("2020-01-01T00:00:00.000Z"),
  });

  const result = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "10.00", clientOperationId: unique("op") },
  });
  assert.equal(result.status, "RECORDED");
});

test("an amount that does not exactly match the frozen expectedAmount is rejected -- underpayment", async () => {
  const fixture = await createActiveCircleWithObligation("50.00");
  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
      }),
    ContributionAmountMismatchError,
  );
});

test("an amount that does not exactly match the frozen expectedAmount is rejected -- overpayment", async () => {
  const fixture = await createActiveCircleWithObligation("50.00");
  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { obligationId: fixture.obligationId, amount: "75.00", clientOperationId: unique("op") },
      }),
    ContributionAmountMismatchError,
  );
});

test("zero, negative, and over-precise amounts are all rejected by the service's own defensive parse", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  for (const amount of ["0.00", "-25.00", "25.999"]) {
    await assert.rejects(
      () =>
        recordContribution({
          ownerId: fixture.ownerId,
          circleId: fixture.circleId,
          input: { obligationId: fixture.obligationId, amount, clientOperationId: unique("op") },
        }),
      InvalidContributionAmountError,
      `expected amount "${amount}" to be rejected`,
    );
  }
});

test("a duplicate submission of the same operation replays the original payment, no second row is created", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const clientOperationId = unique("op");
  const input = { obligationId: fixture.obligationId, amount: "25.00", clientOperationId };

  const first = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  const second = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  assert.equal(second.id, first.id);
  const count = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(count, 1);
});

test("replaying a since-CONFIRMED payment's operation succeeds and reports its true current status", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const clientOperationId = unique("op");
  const input = { obligationId: fixture.obligationId, amount: "25.00", clientOperationId };

  const recorded = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  await prisma.contributionPayment.update({
    where: { id: recorded.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: fixture.ownerId },
  });

  const replay = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  assert.equal(replay.id, recorded.id);
  assert.equal(replay.status, "CONFIRMED");
  const count = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(count, 1);
});

test("replaying a since-REJECTED payment's operation succeeds and reports its true current status", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const clientOperationId = unique("op");
  const input = { obligationId: fixture.obligationId, amount: "25.00", clientOperationId };

  const recorded = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  await prisma.contributionPayment.update({
    where: { id: recorded.id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: fixture.ownerId, rejectionReason: "Wrong amount handed over." },
  });

  const replay = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  assert.equal(replay.id, recorded.id);
  assert.equal(replay.status, "REJECTED");
});

test("a replay of an already-REJECTED operation succeeds even though the circle is no longer ACTIVE", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const clientOperationId = unique("op");
  const input = { obligationId: fixture.obligationId, amount: "25.00", clientOperationId };

  const recorded = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  await prisma.contributionPayment.update({
    where: { id: recorded.id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: fixture.ownerId, rejectionReason: "reason" },
  });
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  const replay = await recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  assert.equal(replay.id, recorded.id);
  assert.equal(replay.status, "REJECTED");
});

test("reusing an operation id with a different obligation is a conflict, not a silent replay", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "25.00");
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  // PayoutRound has @@unique([circleId, recipientId]) -- each round needs
  // its own distinct recipient, so a second round requires a second member.
  const memberTwoId = await createFixtureMember(circleId, ownerId, "B", 2);
  const roundId = await createFixtureRound(circleId, {
    roundNumber: 1,
    recipientId: memberId,
    dueDate: new Date("2026-01-08T00:00:00.000Z"),
    status: "UPCOMING",
  });
  const obligationOneId = await createFixtureObligation(circleId, roundId, memberId, {
    expectedAmount: "25.00",
    dueDate: new Date("2026-01-08T00:00:00.000Z"),
  });
  const roundTwoId = await createFixtureRound(circleId, {
    roundNumber: 2,
    recipientId: memberTwoId,
    dueDate: new Date("2026-01-15T00:00:00.000Z"),
    status: "UPCOMING",
  });
  const obligationTwoId = await createFixtureObligation(circleId, roundTwoId, memberId, {
    expectedAmount: "25.00",
    dueDate: new Date("2026-01-15T00:00:00.000Z"),
  });

  const clientOperationId = unique("op");
  await recordContribution({
    ownerId,
    circleId,
    input: { obligationId: obligationOneId, amount: "25.00", clientOperationId },
  });

  await assert.rejects(
    () =>
      recordContribution({
        ownerId,
        circleId,
        input: { obligationId: obligationTwoId, amount: "25.00", clientOperationId },
      }),
    ContributionOperationConflictError,
  );
});

test("reusing an operation id with a different amount (same obligation) is a conflict, not a silent replay", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const clientOperationId = unique("op");

  await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId },
  });

  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        // Same obligation and operation id, but a different amount -- a
        // reused operation id must never be silently treated as the same
        // financial intent just because the obligation matches too.
        input: { obligationId: fixture.obligationId, amount: "30.00", clientOperationId },
      }),
    ContributionOperationConflictError,
  );

  const count = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(count, 1, "the conflicting replay must not create a second row");
});

test("a fresh attempt with a new operation id is permitted after the prior payment was rejected -- historical row preserved", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const firstOperationId = unique("op");

  const first = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: firstOperationId },
  });
  await prisma.contributionPayment.update({
    where: { id: first.id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: fixture.ownerId, rejectionReason: "Amount not received." },
  });

  const second = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
  });

  assert.notEqual(second.id, first.id);
  assert.equal(second.status, "RECORDED");

  const rows = await prisma.contributionPayment.findMany({ where: { obligationId: fixture.obligationId } });
  assert.equal(rows.length, 2);
  const rejectedRow = rows.find((row) => row.id === first.id);
  assert.ok(rejectedRow, "the original REJECTED row must still exist, never deleted or overwritten");
  assert.equal(rejectedRow?.status, "REJECTED");
  assert.equal(rejectedRow?.rejectionReason, "Amount not received.");
});

test("a new recording attempt against an already-fulfilled (CONFIRMED) obligation is rejected", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const recorded = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
  });
  await prisma.contributionPayment.update({
    where: { id: recorded.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: fixture.ownerId },
  });

  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
      }),
    ContributionObligationAlreadyFulfilledError,
  );
});

test("a new recording attempt against an obligation with an existing RECORDED payment is rejected", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
  });

  await assert.rejects(
    () =>
      recordContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
      }),
    ContributionObligationAlreadyRecordedError,
  );
});

test("concurrent duplicate submissions of the SAME operation id resolve to exactly one payment row", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const clientOperationId = unique("op");
  const input = { obligationId: fixture.obligationId, amount: "25.00", clientOperationId };

  const results = await Promise.allSettled([
    recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input }),
    recordContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent replays of the same operation must resolve successfully");
  }

  const count = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(count, 1);
});

test("concurrent competing operations against the SAME obligation resolve to exactly one RECORDED payment", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");

  const results = await Promise.allSettled([
    recordContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op-a") },
    }),
    recordContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op-b") },
    }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one competing operation must win");
  assert.equal(rejected.length, 1, "exactly one competing operation must lose");
  if (rejected[0]?.status === "rejected") {
    assert.ok(rejected[0].reason instanceof ContributionObligationAlreadyRecordedError);
  }

  const count = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(count, 1);
});

test("recording never marks the obligation FULFILLED and never touches round or circle lifecycle", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
  });

  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligation.status, "OPEN");
  assert.equal(obligation.fulfilledAt, null);

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  assert.equal(round.status, "UPCOMING");

  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

test("the serialized result exposes only the whitelisted provenance fields -- no raw Prisma model, no auth fields", async () => {
  const fixture = await createActiveCircleWithObligation("25.00");
  const result = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op") },
  });

  assert.deepEqual(
    Object.keys(result).sort(),
    ["amount", "circleId", "clientOperationId", "currency", "id", "obligationId", "recordedAt", "recordedById", "status"].sort(),
  );
});

test("recordContribution has no member-session/auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./contribution-recording.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
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
