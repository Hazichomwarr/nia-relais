import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Live-database persistence-contract tests for PayoutRound.closedById
// (7K.12) -- proving the SCHEMA/migration, not any service or repository
// module (none exists yet; this ticket explicitly forbids adding one).
// Every assertion here talks to Prisma/PostgreSQL directly, exactly like
// every other live-fixture suite in this codebase; none of it is a
// source-regex/structural test, and it is not described as one.
//
// No round lifecycle writer exists yet (7K.11/7K.12), so rounds here are
// created directly via prisma.payoutRound.create -- this is acceptable
// specifically because this suite's own purpose is to test the schema
// itself, not to exercise a business-logic entry point that doesn't
// exist.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createUser(name: string) {
  const user = await prisma.user.create({
    data: { name, email: `${unique("closed-by-test-user")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(user.id);
  return user.id;
}

async function createFixtureCircle(ownerId: string) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("ClosedByTestCircle"),
      currency: "USD",
      contributionAmount: "10.00",
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedById: ownerId,
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
  input: { roundNumber: number; recipientId: string; status?: "UPCOMING" | "ACTIVE" | "CLOSED" },
) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: new Date("2026-01-08T00:00:00.000Z"),
      status: input.status ?? "UPCOMING",
    },
    select: { id: true },
  });
  return round.id;
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
// A. Nullable before closure
// -------------------------------------------------------------------

test("a round can be persisted UPCOMING with closedAt and closedById both null", async () => {
  const ownerId = await createUser("Owner A");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member A", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "UPCOMING" });

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
  assert.equal(round.status, "UPCOMING");
  assert.equal(round.closedAt, null);
  assert.equal(round.closedById, null);
});

test("a round can be persisted ACTIVE with closedAt and closedById both still null", async () => {
  const ownerId = await createUser("Owner A2");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member A2", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "ACTIVE" });

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
  assert.equal(round.status, "ACTIVE");
  assert.equal(round.closedAt, null);
  assert.equal(round.closedById, null);
});

// -------------------------------------------------------------------
// B. Actor relation
// -------------------------------------------------------------------

test("a round can reference a valid User through closedById, readable via the closedBy relation", async () => {
  const ownerId = await createUser("Owner B");
  const closerId = await createUser("Closer B");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member B", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "ACTIVE" });

  const closedAt = new Date();
  await prisma.payoutRound.update({
    where: { id: roundId },
    data: { status: "CLOSED", closedAt, closedById: closerId },
  });

  const round = await prisma.payoutRound.findUniqueOrThrow({
    where: { id: roundId },
    include: { closedBy: { select: { id: true, name: true } } },
  });
  assert.equal(round.closedById, closerId);
  assert.equal(round.closedBy?.id, closerId);
  assert.equal(round.closedAt?.getTime(), closedAt.getTime());
});

// -------------------------------------------------------------------
// C. Restrictive FK -- cannot persist a nonexistent closedById
// -------------------------------------------------------------------

test("a nonexistent closedById is rejected by the foreign key, at create time", async () => {
  const ownerId = await createUser("Owner C");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member C", 1);

  await assert.rejects(
    () =>
      prisma.payoutRound.create({
        data: {
          circleId,
          roundNumber: 1,
          recipientId: memberId,
          dueDate: new Date("2026-01-08T00:00:00.000Z"),
          status: "CLOSED",
          closedAt: new Date(),
          closedById: "not-a-real-user-id",
        },
      }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
  );
});

test("a nonexistent closedById is rejected by the foreign key, at update time -- the row is left unchanged", async () => {
  const ownerId = await createUser("Owner C2");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member C2", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "ACTIVE" });

  await assert.rejects(
    () =>
      prisma.payoutRound.update({
        where: { id: roundId },
        data: { status: "CLOSED", closedAt: new Date(), closedById: "not-a-real-user-id" },
      }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
  );

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
  assert.equal(round.status, "ACTIVE", "the rejected update must not have partially applied");
  assert.equal(round.closedById, null);
});

// -------------------------------------------------------------------
// D. Historical actor survives unrelated owner/member changes
// -------------------------------------------------------------------

test("closedById is untouched by unrelated circle/member field changes", async () => {
  const ownerId = await createUser("Owner D");
  const closerId = await createUser("Closer D");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member D", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "ACTIVE" });

  await prisma.payoutRound.update({
    where: { id: roundId },
    data: { status: "CLOSED", closedAt: new Date(), closedById: closerId },
  });

  // Unrelated mutations: circle name, member displayName/payoutOrder.
  await prisma.savingsCircle.update({ where: { id: circleId }, data: { name: "Renamed Circle" } });
  await prisma.circleMember.update({ where: { id: memberId }, data: { displayName: "Renamed Member", payoutOrder: 99 } });

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
  assert.equal(round.closedById, closerId, "closedById must survive unrelated circle/member changes");
  assert.equal(round.status, "CLOSED");
});

// -------------------------------------------------------------------
// E. Explicit nullability -- never implicitly defaulted
// -------------------------------------------------------------------

test("closedById is never implicitly defaulted to the owner, the activator, or the recipient", async () => {
  const ownerId = await createUser("Owner E");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member E", 1);

  // A round created and later activated with activatedById = ownerId,
  // then transitioned to CLOSED WITHOUT ever supplying closedById.
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "UPCOMING" });
  await prisma.payoutRound.update({
    where: { id: roundId },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedById: ownerId },
  });
  await prisma.payoutRound.update({
    where: { id: roundId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
  assert.equal(round.activatedById, ownerId);
  assert.equal(
    round.closedById,
    null,
    "closedById must remain null -- never silently defaulted from activatedById, the recipient, or the circle owner",
  );
});

// -------------------------------------------------------------------
// F. Schema relation -- selectable without widening unrelated reads
// -------------------------------------------------------------------

test("closedById and the closedBy relation are independently selectable, and omitting them omits them entirely", async () => {
  const ownerId = await createUser("Owner F");
  const closerId = await createUser("Closer F");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member F", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "ACTIVE" });
  await prisma.payoutRound.update({
    where: { id: roundId },
    data: { status: "CLOSED", closedAt: new Date(), closedById: closerId },
  });

  const withClosedById = await prisma.payoutRound.findUniqueOrThrow({
    where: { id: roundId },
    select: { id: true, closedById: true },
  });
  assert.deepEqual(Object.keys(withClosedById).sort(), ["closedById", "id"]);
  assert.equal(withClosedById.closedById, closerId);

  const withClosedByRelation = await prisma.payoutRound.findUniqueOrThrow({
    where: { id: roundId },
    select: { id: true, closedBy: { select: { id: true } } },
  });
  assert.deepEqual(Object.keys(withClosedByRelation).sort(), ["closedBy", "id"]);
  assert.equal(withClosedByRelation.closedBy?.id, closerId);

  const withoutClosedFields = await prisma.payoutRound.findUniqueOrThrow({
    where: { id: roundId },
    select: { id: true, status: true },
  });
  assert.deepEqual(Object.keys(withoutClosedFields).sort(), ["id", "status"]);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutClosedFields, "closedById"), false);
});

// -------------------------------------------------------------------
// FK delete behavior -- restrictive, never cascading
// -------------------------------------------------------------------

test("deleting a User referenced by closedById is blocked (RESTRICT), never cascades or silently erases the round", async () => {
  const ownerId = await createUser("Owner G");
  const closerId = await createUser("Closer G");
  const circleId = await createFixtureCircle(ownerId);
  const memberId = await createFixtureMember(circleId, ownerId, "Member G", 1);
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId, status: "ACTIVE" });
  await prisma.payoutRound.update({
    where: { id: roundId },
    data: { status: "CLOSED", closedAt: new Date(), closedById: closerId },
  });

  await assert.rejects(
    () => prisma.user.delete({ where: { id: closerId } }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
  );

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
  assert.equal(round.closedById, closerId, "the round's historical closure provenance must survive the blocked delete attempt");

  const stillExists = await prisma.user.findUnique({ where: { id: closerId } });
  assert.ok(stillExists, "the referenced User must not have been deleted");
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
