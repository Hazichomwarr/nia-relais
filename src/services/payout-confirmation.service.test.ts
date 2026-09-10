import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";
import {
  PayoutConfirmationAccountingIntegrityError,
  PayoutConfirmationCircleNotActiveError,
  PayoutConfirmationDisputedError,
  PayoutConfirmationNotFoundError,
  PayoutConfirmationProvenanceIntegrityError,
  PayoutConfirmationReplayIntegrityError,
  PayoutConfirmationUnauthorizedError,
  confirmPayout,
} from "@/src/services/payout-confirmation.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as
// payout-recording.service.test.ts / contribution-confirmation.service
// .test.ts: unique-id-scoped fixtures, FK-ordered cleanup in test.after
// regardless of outcome, before/after row counts on unrelated domain
// tables. No TEST_DATABASE_URL required. Fixtures use the real,
// already-shipped recordPayout (7K.3) to produce a genuinely RECORDED
// payout rather than hand-inserting one, so every fixture starts from
// persistence recordPayout itself would actually produce.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "PAYOUT_CONFIRM_TEST_OWNER", email: `${unique("payout-confirm-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

async function createFixtureCircle(
  ownerId: string,
  status: CircleStatus,
  contributionAmount: string,
  currency = "USD",
) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("PayoutConfirmTestCircle"),
      currency,
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
  input: { roundNumber: number; recipientId: string; dueDate: Date },
) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: input.dueDate,
      status: "UPCOMING",
    },
    select: { id: true },
  });
  return round.id;
}

async function createFixtureObligation(
  circleId: string,
  roundId: string,
  memberId: string,
  input: { expectedAmount: string; currency?: string; dueDate?: Date },
) {
  const obligation = await prisma.contributionObligation.create({
    data: {
      circleId,
      roundId,
      memberId,
      expectedAmount: input.expectedAmount,
      currency: input.currency ?? "USD",
      dueDate: input.dueDate ?? new Date("2026-01-08T00:00:00.000Z"),
      status: "OPEN",
    },
    select: { id: true },
  });
  return obligation.id;
}

/**
 * A genuinely RECORDED payout: an ACTIVE circle, `memberAmounts.length`
 * members, one round (recipient = the first member), one obligation per
 * member for that round, and one RECORDED Payout produced by the real
 * recordPayout service (7K.3) -- never hand-inserted.
 */
async function createRecordedPayoutFixture(options?: {
  memberAmounts?: readonly string[];
  currency?: string;
}) {
  const memberAmounts = options?.memberAmounts ?? ["25.00"];
  const currency = options?.currency ?? "USD";
  const total = memberAmounts.reduce((sum, value) => sum + Number(value), 0).toFixed(2);

  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", memberAmounts[0], currency);

  const memberIds: string[] = [];
  for (const [index] of memberAmounts.entries()) {
    memberIds.push(await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1));
  }

  const dueDate = new Date("2026-01-08T00:00:00.000Z");
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberIds[0], dueDate });

  const obligationIds: string[] = [];
  for (const [index, expectedAmount] of memberAmounts.entries()) {
    obligationIds.push(
      await createFixtureObligation(circleId, roundId, memberIds[index], { expectedAmount, currency, dueDate }),
    );
  }

  const recipientId = memberIds[0];
  const recorded = await recordPayout({
    ownerId,
    circleId,
    input: { roundId, amount: total, clientOperationId: unique("op") },
  });

  return { ownerId, circleId, roundId, memberIds, obligationIds, recipientId, payoutId: recorded.id, total };
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

// -------------------------------------------------------------------
// Happy path
// -------------------------------------------------------------------

test("the persisted recipient confirms a RECORDED payout, which becomes CONFIRMED", async () => {
  const fixture = await createRecordedPayoutFixture();
  const before = new Date();

  const result = await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.id, fixture.payoutId);
  assert.equal(result.circleId, fixture.circleId);
  assert.equal(result.roundId, fixture.roundId);
  assert.equal(result.confirmedByMemberId, fixture.recipientId);
  assert.ok(new Date(result.confirmedAt).getTime() >= before.getTime() - 1000);

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "CONFIRMED");
  assert.equal(persisted.confirmedByMemberId, fixture.recipientId);
  assert.ok(persisted.confirmedAt);
});

test("recording provenance is unchanged by confirmation", async () => {
  const fixture = await createRecordedPayoutFixture();
  const before = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });

  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });

  const after = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(after.circleId, before.circleId);
  assert.equal(after.roundId, before.roundId);
  assert.ok(after.amount.equals(before.amount));
  assert.equal(after.currency, before.currency);
  assert.equal(after.clientOperationId, before.clientOperationId);
  assert.equal(after.recordedById, before.recordedById);
  assert.equal(after.recordedAt.toISOString(), before.recordedAt.toISOString());
});

test("the serialized result exposes only the whitelisted fields", async () => {
  const fixture = await createRecordedPayoutFixture();
  const result = await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });

  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "amount",
      "circleId",
      "confirmedAt",
      "confirmedByMemberId",
      "currency",
      "id",
      "recordedAt",
      "recordedById",
      "roundId",
      "status",
    ].sort(),
  );
});

// -------------------------------------------------------------------
// Authorization
// -------------------------------------------------------------------

test("a non-recipient member of the same circle is rejected as unauthorized", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: otherMemberId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationUnauthorizedError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "RECORDED");
});

test("a member of a different circle entirely is rejected as not found, not unauthorized", async () => {
  const fixture = await createRecordedPayoutFixture();
  const foreignCircleId = await createFixtureCircle(fixture.ownerId, "ACTIVE", "10.00");
  const foreignMemberId = await createFixtureMember(foreignCircleId, fixture.ownerId, "FOREIGN", 1);

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: foreignMemberId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationNotFoundError,
  );
});

test("a nonexistent circle is rejected as not found", async () => {
  await assert.rejects(
    () =>
      confirmPayout({
        circleId: "does-not-exist",
        memberId: "does-not-exist",
        input: { payoutId: "does-not-exist" },
      }),
    PayoutConfirmationNotFoundError,
  );
});

test("a nonexistent payout is rejected as not found", async () => {
  const fixture = await createRecordedPayoutFixture();

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: "no-such-payout" },
      }),
    PayoutConfirmationNotFoundError,
  );
});

test("a foreign payout (belonging to a different circle) collapses to the same not-found outcome", async () => {
  const fixtureA = await createRecordedPayoutFixture();
  const fixtureB = await createRecordedPayoutFixture();

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixtureB.circleId,
        memberId: fixtureB.recipientId,
        input: { payoutId: fixtureA.payoutId },
      }),
    PayoutConfirmationNotFoundError,
  );
});

test("confirmPayout does not accept a member/recipient identifier in its input", () => {
  const servicePath = fileURLToPath(new URL("./payout-confirmation.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8");
  assert.doesNotMatch(source, /input\.memberId/);
  assert.doesNotMatch(source, /input\.recipientId/);
});

test("confirmPayout has no owner-auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./payout-confirmation.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireUser/);
  assert.doesNotMatch(source, /ownerId/);
});

// -------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------

test("a fresh confirmation succeeds while the circle is ACTIVE", async () => {
  const fixture = await createRecordedPayoutFixture();
  const result = await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  assert.equal(result.status, "CONFIRMED");
});

test("a fresh confirmation on a non-ACTIVE circle is rejected", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationCircleNotActiveError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "RECORDED");
});

for (const status of ["COMPLETED", "ARCHIVED"] as const) {
  test(`a CONFIRMED replay succeeds after the circle becomes ${status}`, async () => {
    const fixture = await createRecordedPayoutFixture();
    const first = await confirmPayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId },
    });

    await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status } });

    const replay = await confirmPayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId },
    });
    assert.deepEqual(replay, first);
  });
}

// -------------------------------------------------------------------
// State transitions / replay
// -------------------------------------------------------------------

test("a duplicate confirmation replays the existing CONFIRMED state without writing again", async () => {
  const fixture = await createRecordedPayoutFixture();
  const first = await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  const before = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  const after = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });

  assert.deepEqual(second, first);
  assert.equal(after.confirmedAt?.getTime(), before.confirmedAt?.getTime(), "replay must not regenerate confirmedAt");
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "a replay must not write the row at all");
});

test("a DISPUTED payout cannot be confirmed -- terminal conflict, never overwritten", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.payout.update({
    where: { id: fixture.payoutId },
    data: {
      status: "DISPUTED",
      disputedAt: new Date(),
      disputedByMemberId: fixture.recipientId,
      disputeReason: "Not received.",
    },
  });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationDisputedError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "DISPUTED");
  assert.equal(persisted.disputeReason, "Not received.");
});

test("a DISPUTED payout stays DISPUTED even after the circle becomes COMPLETED", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.payout.update({
    where: { id: fixture.payoutId },
    data: { status: "DISPUTED", disputedAt: new Date(), disputedByMemberId: fixture.recipientId, disputeReason: "x" },
  });
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationDisputedError,
  );
});

test("confirmation never writes dispute provenance", async () => {
  const fixture = await createRecordedPayoutFixture();
  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.disputedAt, null);
  assert.equal(persisted.disputedByMemberId, null);
  assert.equal(persisted.disputeReason, null);
});

// -------------------------------------------------------------------
// Integrity
// -------------------------------------------------------------------

test("a persisted amount mismatch against frozen obligation history is an accounting integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.payout.update({ where: { id: fixture.payoutId }, data: { amount: "26.00" } });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationAccountingIntegrityError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "RECORDED");
});

test("a persisted currency mismatch against the authoritative round currency is an accounting integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.payout.update({ where: { id: fixture.payoutId }, data: { currency: "EUR" } });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationAccountingIntegrityError,
  );
});

test("obligations disagreeing on currency after recording surface the domain's own accounting integrity error", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  await prisma.contributionObligation.update({ where: { id: fixture.obligationIds[1] }, data: { currency: "EUR" } });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutAccountingIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray confirmation provenance is a provenance integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  // Manufactured corruption -- no writer in this codebase can produce a
  // RECORDED row with confirmedByMemberId already set.
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedByMemberId" = ${fixture.recipientId} WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationProvenanceIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray dispute provenance is a provenance integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${fixture.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationProvenanceIntegrityError,
  );
});

test("a CONFIRMED payout with contradictory dispute provenance fails replay as a corrupted-history conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${fixture.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationReplayIntegrityError,
  );
});

test("a CONFIRMED payout whose confirmedByMemberId does not match the persisted recipient fails replay", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];
  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  // Manufactured corruption: the persisted recipient never changes, but the
  // confirmation actor recorded on the row is overwritten to someone else.
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedByMemberId" = ${otherMemberId} WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationReplayIntegrityError,
  );
});

test("a CONFIRMED payout whose amount no longer matches the frozen obligation sum fails replay, never auto-repaired", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  await prisma.contributionObligation.update({
    where: { id: fixture.obligationIds[1] },
    data: { expectedAmount: "30.00" },
  });

  await assert.rejects(
    () =>
      confirmPayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId },
      }),
    PayoutConfirmationReplayIntegrityError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "CONFIRMED", "never repaired -- the corrupted row is left exactly as found");
});

// -------------------------------------------------------------------
// Concurrency (real Postgres)
// -------------------------------------------------------------------

test("two concurrent confirmations of the SAME RECORDED payout resolve safely to exactly one fresh transition", async () => {
  const fixture = await createRecordedPayoutFixture();

  const results = await Promise.allSettled([
    confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: fixture.payoutId } }),
    confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: fixture.payoutId } }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent confirmations must resolve safely");
  }
  const values = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  assert.deepEqual(values[0], values[1], "both calls must resolve to the identical CONFIRMED state");

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "CONFIRMED");
});

// -------------------------------------------------------------------
// Architecture
// -------------------------------------------------------------------

test("confirmPayout mutates nothing but the Payout row's status/confirmedAt/confirmedByMemberId", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  const roundBefore = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  const obligationsBefore = await prisma.contributionObligation.findMany({
    where: { roundId: fixture.roundId },
    orderBy: { id: "asc" },
  });
  const circleBefore = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });

  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });

  const roundAfter = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  assert.deepEqual(roundAfter, roundBefore, "PayoutRound must be untouched");

  const obligationsAfter = await prisma.contributionObligation.findMany({
    where: { roundId: fixture.roundId },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(obligationsAfter, obligationsBefore, "ContributionObligation rows must be untouched");

  const circleAfter = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.deepEqual(circleAfter, circleBefore, "SavingsCircle lifecycle must be untouched");

  assert.equal(
    await prisma.contributionPayment.count({ where: { circleId: fixture.circleId } }),
    0,
    "no ContributionPayment may be created or changed",
  );
});

test("confirmPayout reads no round status, due date, or live-cohort signal", () => {
  const servicePath = fileURLToPath(new URL("./payout-confirmation.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /dueDate/);
  assert.doesNotMatch(source, /payoutOrder/);
  assert.doesNotMatch(source, /round\.status/);
  assert.doesNotMatch(source, /roundStatus/);
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
