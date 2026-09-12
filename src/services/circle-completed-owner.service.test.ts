import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  CompletedCircleOwnerReadAuthorizationError,
  CompletedCircleOwnerReadNotCompletedError,
  CompletedCircleOwnerReadNotFoundError,
  getCompletedCircleSummaryForOwner,
} from "@/src/services/circle-completed-owner.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as circle-active-owner
// .service.test.ts: unique-id-scoped fixtures, FK-ordered cleanup in
// test.after regardless of outcome, before/after row counts on unrelated
// domain tables. No TEST_DATABASE_URL required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "COMPLETED_OWNER_TEST_OWNER", email: `${unique("completed-owner-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

async function createFixtureCircle(
  ownerId: string,
  status: CircleStatus,
  overrides: { completedAt?: Date | null; completedById?: string | null } = {},
) {
  const isActivated = status !== "DRAFT";
  const isCompleted = status === "COMPLETED";
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("CompletedOwnerTestCircle"),
      currency: "USD",
      contributionAmount: "10.00",
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
      activatedAt: isActivated ? new Date("2026-01-02T00:00:00.000Z") : null,
      activatedById: isActivated ? ownerId : null,
      completedAt: isCompleted ? new Date("2026-03-01T00:00:00.000Z") : (overrides.completedAt ?? null),
      completedById: isCompleted ? ownerId : (overrides.completedById ?? null),
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
    await prisma.circleMember.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.savingsCircle.deleteMany({ where: { id: { in: circleIds } } });
  }
  const userIds = [...ownedResourceIds.userIds];
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

test("reads a COMPLETED circle's historical summary: terms, status, completedAt, ordered members", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "COMPLETED");
  await createFixtureMember(circleId, ownerId, "Second", 2);
  await createFixtureMember(circleId, ownerId, "First", 1);

  const result = await getCompletedCircleSummaryForOwner({ ownerId, circleId });

  assert.equal(result.circle.status, "COMPLETED");
  assert.equal(result.circle.currency, "USD");
  assert.equal(result.circle.contributionAmount, "10.00");
  assert.equal(result.circle.frequency, "WEEKLY");
  assert.ok(result.circle.completedAt.length > 0);
  assert.equal(result.memberCount, 2);
  assert.deepEqual(result.members.map((member) => member.payoutOrder), [1, 2], "members are ordered by payoutOrder");
});

test("no actor id (completedById/activatedById) is ever exposed", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "COMPLETED");

  const result = await getCompletedCircleSummaryForOwner({ ownerId, circleId });
  assert.deepEqual(Object.keys(result.circle).sort(), [
    "completedAt",
    "contributionAmount",
    "currency",
    "frequency",
    "id",
    "name",
    "startDate",
    "status",
  ]);
});

test("a nonexistent circle is rejected with CompletedCircleOwnerReadNotFoundError", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => getCompletedCircleSummaryForOwner({ ownerId, circleId: "not-a-real-circle-id" }),
    CompletedCircleOwnerReadNotFoundError,
  );
});

test("a wrong owner is denied with CompletedCircleOwnerReadAuthorizationError", async () => {
  const ownerId = await createOwner();
  const otherOwnerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "COMPLETED");

  await assert.rejects(
    () => getCompletedCircleSummaryForOwner({ ownerId: otherOwnerId, circleId }),
    CompletedCircleOwnerReadAuthorizationError,
  );
});

for (const status of ["DRAFT", "ACTIVE", "CANCELLED", "ARCHIVED"] as const) {
  test(`a ${status} circle is rejected with CompletedCircleOwnerReadNotCompletedError, never misrepresented as COMPLETED`, async () => {
    const ownerId = await createOwner();
    const circleId = await createFixtureCircle(ownerId, status);

    await assert.rejects(
      () => getCompletedCircleSummaryForOwner({ ownerId, circleId }),
      CompletedCircleOwnerReadNotCompletedError,
    );
  });
}

test("this suite makes no financial/domain lifecycle mutation outside the SUSU tables it created", async () => {
  const finalCounts = {
    users: (await prisma.user.count()) - ownedResourceIds.userIds.size,
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});
