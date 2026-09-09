import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ActiveCircleOwnerReadAuthorizationError,
  ActiveCircleOwnerReadNotActiveError,
  ActiveCircleOwnerReadNotFoundError,
  getActiveCircleSummaryForOwner,
} from "@/src/services/circle-active-owner.service";
import { prisma } from "@/src/prisma";

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "ACTIVE_OWNER_TEST_OWNER", email: `${unique("active-owner-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED";

async function createFixtureCircle(ownerId: string, status: CircleStatus, contributionAmount = "10.00") {
  const isActivated = status !== "DRAFT";
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("ActiveOwnerTestCircle"),
      currency: "USD",
      contributionAmount,
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
      activatedAt: isActivated ? new Date("2026-01-02T00:00:00.000Z") : null,
      activatedById: isActivated ? ownerId : null,
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
    select: { id: true, memberCode: true },
  });
  return { id: member.id, memberCode: member.memberCode, displayName, payoutOrder };
}

async function createFixtureRound(
  circleId: string,
  input: { roundNumber: number; recipientId: string; dueDate: Date; status: "UPCOMING" | "ACTIVE" | "CLOSED" },
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

// owner can read own ACTIVE circle
test("the owner can read their own ACTIVE circle's full summary", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "25.50");
  const a = await createFixtureMember(circleId, ownerId, "Amara", 1);
  const b = await createFixtureMember(circleId, ownerId, "Kwame", 2);
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2026-01-01T00:00:00.000Z"), status: "UPCOMING" });
  await createFixtureRound(circleId, { roundNumber: 2, recipientId: b.id, dueDate: new Date("2026-01-08T00:00:00.000Z"), status: "UPCOMING" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.equal(result.circle.id, circleId);
  assert.equal(result.circle.status, "ACTIVE");
  assert.equal(result.circle.contributionAmount, "25.50");
  assert.equal(result.circle.activatedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(result.members.length, 2);
  assert.equal(result.rounds.length, 2);
  assert.equal(result.totalRoundCount, 2);
});

// cross-owner/nonexistent access denied
test("a different owner is denied with a specific authorization error", async () => {
  const ownerA = await createOwner();
  const ownerB = await createOwner();
  const circleId = await createFixtureCircle(ownerA, "ACTIVE");

  await assert.rejects(
    () => getActiveCircleSummaryForOwner({ ownerId: ownerB, circleId }),
    ActiveCircleOwnerReadAuthorizationError,
  );
});

test("a nonexistent circleId is rejected as not found", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => getActiveCircleSummaryForOwner({ ownerId, circleId: "cnonexistentcircleidxxxxxx" }),
    ActiveCircleOwnerReadNotFoundError,
  );
});

// DRAFT rejected by ACTIVE read
test("a DRAFT circle is rejected -- this read is ACTIVE-only", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");

  await assert.rejects(
    () => getActiveCircleSummaryForOwner({ ownerId, circleId }),
    ActiveCircleOwnerReadNotActiveError,
  );
});

// COMPLETED/ARCHIVED not misrepresented as ACTIVE
test("COMPLETED and ARCHIVED circles are also rejected -- never misrepresented as ACTIVE", async () => {
  const ownerId = await createOwner();
  const completedId = await createFixtureCircle(ownerId, "COMPLETED");
  const archivedId = await createFixtureCircle(ownerId, "ARCHIVED");

  await assert.rejects(
    () => getActiveCircleSummaryForOwner({ ownerId, circleId: completedId }),
    ActiveCircleOwnerReadNotActiveError,
  );
  await assert.rejects(
    () => getActiveCircleSummaryForOwner({ ownerId, circleId: archivedId }),
    ActiveCircleOwnerReadNotActiveError,
  );
});

// persisted rotation returned in roundNumber order
test("the rotation is returned in roundNumber order regardless of creation order", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  const b = await createFixtureMember(circleId, ownerId, "B", 2);
  const c = await createFixtureMember(circleId, ownerId, "C", 3);
  // Created out of roundNumber order on purpose.
  await createFixtureRound(circleId, { roundNumber: 3, recipientId: c.id, dueDate: new Date("2026-01-15T00:00:00.000Z"), status: "UPCOMING" });
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2026-01-01T00:00:00.000Z"), status: "UPCOMING" });
  await createFixtureRound(circleId, { roundNumber: 2, recipientId: b.id, dueDate: new Date("2026-01-08T00:00:00.000Z"), status: "UPCOMING" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.deepEqual(result.rounds.map((round) => round.roundNumber), [1, 2, 3]);
});

// recipient identity comes from persisted recipientId
test("recipient identity comes from the round's own persisted recipientId, not from current member.payoutOrder", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "Amara", 1);
  const b = await createFixtureMember(circleId, ownerId, "Kwame", 2);
  // Deliberately mismatched: round 1's recipient is member B, even though
  // member B's OWN payoutOrder field is 2 -- proving the summary reads the
  // round's own recipientId, never re-derives "whoever has payoutOrder=1."
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: b.id, dueDate: new Date("2026-01-01T00:00:00.000Z"), status: "UPCOMING" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.equal(result.rounds[0].recipientDisplayName, "Kwame");
  assert.equal(result.rounds[0].recipientMemberCode, b.memberCode);
  assert.notEqual(result.rounds[0].recipientDisplayName, a.displayName);
});

// persisted due dates and statuses preserved
test("persisted due dates and statuses are returned verbatim, never recomputed", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  // A due date far in the past AND a status of CLOSED -- if this were
  // recomputed from "today" it might look different; it must come back
  // exactly as persisted.
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2020-06-15T00:00:00.000Z"), status: "CLOSED" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.equal(result.rounds[0].dueDate, "2020-06-15T00:00:00.000Z");
  assert.equal(result.rounds[0].status, "CLOSED");
  assert.equal(result.closedRoundCount, 1);
});

// no synthetic ACTIVE round based on current date
test("a round whose due date is in the past but whose persisted status is UPCOMING is never reported as current/ACTIVE", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2000-01-01T00:00:00.000Z"), status: "UPCOMING" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.equal(result.currentRound, null);
  assert.equal(result.nextRound?.status, "UPCOMING");
});

// current/next round selection
test("exactly one ACTIVE round is reported as currentRound", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  const b = await createFixtureMember(circleId, ownerId, "B", 2);
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2026-01-01T00:00:00.000Z"), status: "CLOSED" });
  await createFixtureRound(circleId, { roundNumber: 2, recipientId: b.id, dueDate: new Date("2026-01-08T00:00:00.000Z"), status: "ACTIVE" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.equal(result.currentRound?.roundNumber, 2);
  assert.equal(result.nextRound, null);
});

// member codes visible, PINs absent
test("memberCode is visible; pinHash and other credential/session fields are never selected or returned", async () => {
  const repositoryPath = fileURLToPath(new URL("../repositories/circle-active-owner.repository.ts", import.meta.url));
  const servicePath = fileURLToPath(new URL("./circle-active-owner.service.ts", import.meta.url));
  const repositoryCode = readFileSync(repositoryPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const serviceCode = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const forbidden of ["pinHash", "failedPinAttempts", "lockedUntil", "credentialVersion", "tokenHash", "email"]) {
    assert.ok(!repositoryCode.includes(forbidden), `repository must not select "${forbidden}"`);
    assert.ok(!serviceCode.includes(forbidden), `service must not reference "${forbidden}"`);
  }

  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circleId, ownerId, "Amara", 1);

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.match(result.members[0].memberCode, /^[A-F0-9]{16}$/);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["pinHash", "failedPinAttempts", "lockedUntil", "credentialVersion", "tokenHash"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

// Decimal/date serialization
test("no Prisma.Decimal or Date instance ever leaves the service", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2026-01-01T00:00:00.000Z"), status: "UPCOMING" });

  const result = await getActiveCircleSummaryForOwner({ ownerId, circleId });
  assert.equal(Object.prototype.toString.call(result.circle.contributionAmount), "[object String]");
  assert.equal(Object.prototype.toString.call(result.circle.startDate), "[object String]");
  assert.equal(Object.prototype.toString.call(result.circle.activatedAt), "[object String]");
  assert.equal(Object.prototype.toString.call(result.rounds[0].dueDate), "[object String]");
});

// no financial mutations
test("no financial mutation occurs -- rounds/members are unchanged after reading the summary twice", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: a.id, dueDate: new Date("2026-01-01T00:00:00.000Z"), status: "UPCOMING" });

  const roundsBefore = await prisma.payoutRound.findMany({ where: { circleId } });
  const membersBefore = await prisma.circleMember.findMany({ where: { circleId } });
  await getActiveCircleSummaryForOwner({ ownerId, circleId });
  await getActiveCircleSummaryForOwner({ ownerId, circleId });
  const roundsAfter = await prisma.payoutRound.findMany({ where: { circleId } });
  const membersAfter = await prisma.circleMember.findMany({ where: { circleId } });

  assert.deepEqual(roundsAfter, roundsBefore);
  assert.deepEqual(membersAfter, membersBefore);
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
