import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DraftCircleOwnerReadAuthorizationError,
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
  getDraftCircleForOwner,
} from "@/src/services/circle-draft-owner.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket: unique-id-scoped fixtures, FK-safe cleanup in test.after
// regardless of outcome, before/after row counts on unrelated tables. No
// TEST_DATABASE_URL required (nothing here is destructive/broad).

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "DRAFT_OWNER_READ_TEST_OWNER", email: `${unique("draft-owner-read-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

async function createFixtureCircle(
  ownerId: string,
  status: CircleStatus,
  overrides: { contributionAmount?: string; currency?: string; frequency?: "WEEKLY" | "BIWEEKLY" | "MONTHLY" } = {},
) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("DraftOwnerReadTestCircle"),
      currency: overrides.currency ?? "USD",
      contributionAmount: overrides.contributionAmount ?? "42.50",
      frequency: overrides.frequency ?? "MONTHLY",
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      status,
    },
    select: { id: true },
  });
  ownedResourceIds.circleIds.add(circle.id);
  return circle.id;
}

async function createFixtureMember(
  circleId: string,
  ownerId: string,
  input: {
    displayName: string;
    email?: string | null;
    status?: "ACTIVE" | "REMOVED";
    payoutOrder?: number | null;
    addedAt?: Date;
    removedAt?: Date | null;
  },
) {
  return prisma.circleMember.create({
    data: {
      circleId,
      displayName: input.displayName,
      email: input.email ?? null,
      memberCode: unique("CODE").toUpperCase().replace(/[^A-F0-9]/g, "0").slice(0, 16).padEnd(16, "0"),
      pinHash: "not-a-real-hash",
      status: input.status ?? "ACTIVE",
      payoutOrder: input.payoutOrder ?? null,
      addedAt: input.addedAt ?? new Date(),
      addedById: ownerId,
      removedAt: input.removedAt ?? null,
      removedById: input.status === "REMOVED" ? ownerId : null,
    },
    select: { id: true, memberCode: true },
  });
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

// ---------------------------------------------------------------------------

// A. owner can read own DRAFT circle
test("A. the owner can read their own DRAFT circle", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  assert.equal(result.circle.id, circleId);
  assert.equal(result.circle.status, "DRAFT");
});

// B. cross-owner access denied
test("B. a different owner is denied with a specific authorization error", async () => {
  const ownerA = await createOwner();
  const ownerB = await createOwner();
  const circleId = await createFixtureCircle(ownerA, "DRAFT");

  await assert.rejects(
    () => getDraftCircleForOwner({ ownerId: ownerB, circleId }),
    DraftCircleOwnerReadAuthorizationError,
  );
});

// C. nonexistent circle rejected
test("C. a nonexistent circleId is rejected as not found", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => getDraftCircleForOwner({ ownerId, circleId: "cnonexistentcircleidxxxxxx" }),
    DraftCircleOwnerReadNotFoundError,
  );
});

// D. ACTIVE circle rejected
test("D. an ACTIVE circle is rejected through this DRAFT-specific read", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");

  await assert.rejects(
    () => getDraftCircleForOwner({ ownerId, circleId }),
    DraftCircleOwnerReadNotDraftError,
  );
});

// E. COMPLETED/ARCHIVED rejected if reachable
test("E. COMPLETED and ARCHIVED circles are also rejected through this DRAFT-specific read", async () => {
  const ownerId = await createOwner();
  const completedId = await createFixtureCircle(ownerId, "COMPLETED");
  const archivedId = await createFixtureCircle(ownerId, "ARCHIVED");

  await assert.rejects(
    () => getDraftCircleForOwner({ ownerId, circleId: completedId }),
    DraftCircleOwnerReadNotDraftError,
  );
  await assert.rejects(
    () => getDraftCircleForOwner({ ownerId, circleId: archivedId }),
    DraftCircleOwnerReadNotDraftError,
  );
});

// F. circle terms serialized correctly
test("F. circle terms are serialized exactly as configured", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", {
    contributionAmount: "125.5",
    currency: "XOF",
    frequency: "BIWEEKLY",
  });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  assert.equal(result.circle.contributionAmount, "125.50");
  assert.equal(result.circle.currency, "XOF");
  assert.equal(result.circle.frequency, "BIWEEKLY");
  assert.equal(result.circle.startDate, "2026-03-01");
});

// G. ACTIVE members returned
test("G. active members are returned with their full read-model shape", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "Amara", email: "amara@example.invalid", payoutOrder: 1 });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0].displayName, "Amara");
  assert.equal(result.members[0].status, "ACTIVE");
  assert.equal(result.members[0].payoutOrder, 1);
});

// H. REMOVED members retained
test("H. removed members remain in the read model as historical records, not reactivated or rewritten", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  const removedAt = new Date("2026-02-15T00:00:00.000Z");
  const removed = await createFixtureMember(circleId, ownerId, {
    displayName: "Kwame",
    status: "REMOVED",
    payoutOrder: null,
    removedAt,
  });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  const found = result.members.find((member) => member.id === removed.id);
  assert.ok(found);
  assert.equal(found?.status, "REMOVED");
  assert.equal(found?.payoutOrder, null);
  assert.equal(found?.removedAt, removedAt.toISOString());
  assert.equal(found?.memberCode, removed.memberCode);
});

// I. deterministic member ordering
test("I. members are ordered deterministically: ACTIVE by payoutOrder/addedAt/id, then REMOVED by removedAt/id", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");

  const activeNoOrder = await createFixtureMember(circleId, ownerId, {
    displayName: "No Order Yet",
    payoutOrder: null,
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const activeOrder2 = await createFixtureMember(circleId, ownerId, {
    displayName: "Second In Line",
    payoutOrder: 2,
    addedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  const activeOrder1 = await createFixtureMember(circleId, ownerId, {
    displayName: "First In Line",
    payoutOrder: 1,
    addedAt: new Date("2026-01-03T00:00:00.000Z"),
  });
  const removedEarlier = await createFixtureMember(circleId, ownerId, {
    displayName: "Removed Earlier",
    status: "REMOVED",
    payoutOrder: null,
    removedAt: new Date("2026-01-10T00:00:00.000Z"),
  });
  const removedLater = await createFixtureMember(circleId, ownerId, {
    displayName: "Removed Later",
    status: "REMOVED",
    payoutOrder: null,
    removedAt: new Date("2026-01-20T00:00:00.000Z"),
  });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  assert.deepEqual(
    result.members.map((member) => member.id),
    [activeOrder1.id, activeOrder2.id, activeNoOrder.id, removedEarlier.id, removedLater.id],
  );
});

// J. memberCode visible
test("J. memberCode is visible in the owner read model", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  const member = await createFixtureMember(circleId, ownerId, { displayName: "Visible Code" });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  assert.equal(result.members[0].memberCode, member.memberCode);
  assert.match(result.members[0].memberCode, /^[A-F0-9]{16}$/);
});

// K. pinHash never selected/returned
// L. credential/session/rate-limit fields absent
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("K/L. pinHash, credential/session/rate-limit fields are never selected or returned", async () => {
  const repositoryPath = fileURLToPath(new URL("../repositories/circle-draft-owner.repository.ts", import.meta.url));
  const servicePath = fileURLToPath(new URL("./circle-draft-owner.service.ts", import.meta.url));
  const repositoryCode = stripComments(readFileSync(repositoryPath, "utf8"));
  const serviceCode = stripComments(readFileSync(servicePath, "utf8"));

  for (const forbidden of [
    "pinHash",
    "failedPinAttempts",
    "lockedUntil",
    "credentialVersion",
    "userId",
    "addedById",
    "removedById",
    "tokenHash",
    "CircleMemberSession",
    "RateLimit",
  ]) {
    assert.ok(!repositoryCode.includes(forbidden), `repository must not reference "${forbidden}"`);
    assert.ok(!serviceCode.includes(forbidden), `service must not reference "${forbidden}"`);
  }

  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "No Secrets" });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  const serialized = JSON.stringify(result);
  for (const forbidden of ["pinHash", "failedPinAttempts", "lockedUntil", "credentialVersion", "tokenHash"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

// M. Decimal/date serialization
test("M. no Prisma.Decimal or Date instance ever leaves the service -- every value is already a string", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "Serialized" });

  const result = await getDraftCircleForOwner({ ownerId, circleId });
  assert.equal(typeof result.circle.contributionAmount, "string");
  assert.equal(typeof result.circle.startDate, "string");
  assert.equal(typeof result.members[0].addedAt, "string");
  // JSON.stringify would throw on a BigInt but silently serialize Decimal/Date
  // objects into something that LOOKS like a string -- assert the exact
  // stringified shape isn't hiding a stray object with a toJSON method.
  assert.equal(Object.prototype.toString.call(result.circle.contributionAmount), "[object String]");
  assert.equal(Object.prototype.toString.call(result.circle.startDate), "[object String]");
});

// N. no transaction lock used
test("N. this service never opens a transaction or takes a row lock", () => {
  const repositoryPath = fileURLToPath(new URL("../repositories/circle-draft-owner.repository.ts", import.meta.url));
  const servicePath = fileURLToPath(new URL("./circle-draft-owner.service.ts", import.meta.url));
  const repositoryCode = stripComments(readFileSync(repositoryPath, "utf8"));
  const serviceCode = stripComments(readFileSync(servicePath, "utf8"));

  for (const source of [repositoryCode, serviceCode]) {
    assert.doesNotMatch(source, /\$transaction/);
    assert.doesNotMatch(source, /FOR UPDATE/);
    assert.doesNotMatch(source, /lockSavingsCircleForUpdate/);
  }
});

// O. no mutation occurs
test("O. reading a circle performs no mutation -- member/circle rows are unchanged before and after", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "Unmutated" });

  const before = await prisma.circleMember.findMany({ where: { circleId }, orderBy: { id: "asc" } });
  await getDraftCircleForOwner({ ownerId, circleId });
  await getDraftCircleForOwner({ ownerId, circleId });
  const after = await prisma.circleMember.findMany({ where: { circleId }, orderBy: { id: "asc" } });

  assert.deepEqual(after, before);
});

// P. no cookie/Auth.js/member-session dependency
test("P. no cookie, Auth.js, or member-session dependency exists in this service or its repository", () => {
  const repositoryPath = fileURLToPath(new URL("../repositories/circle-draft-owner.repository.ts", import.meta.url));
  const servicePath = fileURLToPath(new URL("./circle-draft-owner.service.ts", import.meta.url));
  const repositoryCode = stripComments(readFileSync(repositoryPath, "utf8"));
  const serviceCode = stripComments(readFileSync(servicePath, "utf8"));

  for (const source of [repositoryCode, serviceCode]) {
    for (const forbidden of ["next/headers", "next-auth", "@/auth", "requireUser", "requireCircleMember", "validateCircleMemberSession", "nia_member_session"]) {
      assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
    }
  }
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
