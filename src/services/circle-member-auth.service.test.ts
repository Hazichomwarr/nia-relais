import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { hash } from "bcryptjs";

import {
  CircleMemberAuthenticationError,
  verifyCircleMemberCredentials,
} from "@/src/services/circle-member-auth.service";
import { prisma } from "@/src/prisma";
import { randomTestCircleCode } from "@/src/testing/circle-code-fixture";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket: unique-id-scoped fixtures, FK-safe cleanup in test.after
// regardless of outcome. No TEST_DATABASE_URL required (nothing here is
// destructive/broad -- every row this file creates is deleted in
// test.after). Covers the 10E credential-verification contract end to end
// against real Postgres and real bcrypt, exactly the scenarios listed in
// the ticket's own §17 test requirements.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "MEMBER_AUTH_TEST_OWNER", email: `${unique("member-auth-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

async function createFixtureCircle(ownerId: string, status: CircleStatus, circleCode: string = randomTestCircleCode()) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      circleCode,
      name: unique("MemberAuthTestCircle"),
      currency: "USD",
      contributionAmount: "10.00",
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
    },
    select: { id: true, circleCode: true },
  });
  ownedResourceIds.circleIds.add(circle.id);
  return circle;
}

async function createFixtureMember(
  circleId: string,
  ownerId: string,
  input: { memberCode: string; pin: string; status?: "ACTIVE" | "REMOVED" },
) {
  const pinHash = await hash(input.pin, 4); // low bcrypt cost: these tests hash many PINs and don't need production cost.
  const member = await prisma.circleMember.create({
    data: {
      circleId,
      displayName: unique("Member"),
      memberCode: input.memberCode,
      pinHash,
      status: input.status ?? "ACTIVE",
      addedAt: new Date(),
      addedById: ownerId,
      removedAt: input.status === "REMOVED" ? new Date() : null,
      removedById: input.status === "REMOVED" ? ownerId : null,
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
  await prisma.circleMember.deleteMany({ where: { circleId: { in: [...ownedResourceIds.circleIds] } } });
  await prisma.savingsCircle.deleteMany({ where: { id: { in: [...ownedResourceIds.circleIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...ownedResourceIds.userIds] } } });
  await prisma.$disconnect();
});

test("valid new-format credentials (circleCode + new memberCode) succeed", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  const memberId = await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  const verified = await verifyCircleMemberCredentials({
    circleCode: circle.circleCode,
    memberCode: "K7M4Q8",
    pin: "123456",
  });

  assert.equal(verified.circleId, circle.id);
  assert.equal(verified.memberId, memberId);
});

test("valid legacy credentials (raw circle id + legacy 16-hex memberCode) still succeed", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  const legacyMemberCode = "ABCDEF0123456789";
  const memberId = await createFixtureMember(circle.id, ownerId, { memberCode: legacyMemberCode, pin: "654321" });

  const verified = await verifyCircleMemberCredentials({
    circleCode: circle.id,
    memberCode: legacyMemberCode,
    pin: "654321",
  });

  assert.equal(verified.circleId, circle.id);
  assert.equal(verified.memberId, memberId);
});

test("circleCode is case-insensitive at login", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  const verified = await verifyCircleMemberCredentials({
    circleCode: circle.circleCode.toLowerCase(),
    memberCode: "K7M4Q8",
    pin: "123456",
  });

  assert.equal(verified.circleId, circle.id);
});

test("memberCode is case-insensitive at login", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  const verified = await verifyCircleMemberCredentials({
    circleCode: circle.circleCode,
    memberCode: "k7m4q8",
    pin: "123456",
  });

  assert.equal(verified.circleId, circle.id);
});

test("a leading-zero PIN authenticates correctly", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "012345" });

  const verified = await verifyCircleMemberCredentials({
    circleCode: circle.circleCode,
    memberCode: "K7M4Q8",
    pin: "012345",
  });

  assert.equal(verified.circleId, circle.id);
});

test("a wrong circleCode fails generically", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: randomTestCircleCode(),
        memberCode: "K7M4Q8",
        pin: "123456",
      }),
    CircleMemberAuthenticationError,
  );
});

test("a wrong memberCode fails generically", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: circle.circleCode,
        memberCode: "WRNGXZ",
        pin: "123456",
      }),
    CircleMemberAuthenticationError,
  );
});

test("a wrong PIN fails generically", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: circle.circleCode,
        memberCode: "K7M4Q8",
        pin: "999999",
      }),
    CircleMemberAuthenticationError,
  );
});

test("the same memberCode in a different circle cannot authenticate across circles", async () => {
  const ownerId = await createOwner();
  const circleA = await createFixtureCircle(ownerId, "ACTIVE");
  const circleB = await createFixtureCircle(ownerId, "ACTIVE");
  const sharedMemberCode = "SHAREX"; // 6 restricted-alphabet chars, no ambiguous characters (0/O/1/I/L)
  const memberAId = await createFixtureMember(circleA.id, ownerId, { memberCode: sharedMemberCode, pin: "111111" });
  const memberBId = await createFixtureMember(circleB.id, ownerId, { memberCode: sharedMemberCode, pin: "222222" });
  assert.notEqual(memberAId, memberBId);

  // Circle A's member's own PIN does not work against circle B's
  // same-coded member -- the codes only coincide by chance of this test's
  // own construction, and login is scoped by (circleCode, memberCode)
  // together, never memberCode alone.
  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: circleB.circleCode,
        memberCode: sharedMemberCode,
        pin: "111111",
      }),
    CircleMemberAuthenticationError,
  );

  // Each circle's own member, with its own PIN, still resolves correctly
  // and scoped to the right circle.
  const verifiedA = await verifyCircleMemberCredentials({
    circleCode: circleA.circleCode,
    memberCode: sharedMemberCode,
    pin: "111111",
  });
  assert.equal(verifiedA.memberId, memberAId);
  assert.equal(verifiedA.circleId, circleA.id);

  const verifiedB = await verifyCircleMemberCredentials({
    circleCode: circleB.circleCode,
    memberCode: sharedMemberCode,
    pin: "222222",
  });
  assert.equal(verifiedB.memberId, memberBId);
  assert.equal(verifiedB.circleId, circleB.id);
});

test("a removed (inactive) member fails, even with the correct code and PIN", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "ACTIVE");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456", status: "REMOVED" });

  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: circle.circleCode,
        memberCode: "K7M4Q8",
        pin: "123456",
      }),
    CircleMemberAuthenticationError,
  );
});

test("an ineligible (DRAFT) circle fails, even with the correct code and PIN", async () => {
  const ownerId = await createOwner();
  const circle = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circle.id, ownerId, { memberCode: "K7M4Q8", pin: "123456" });

  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: circle.circleCode,
        memberCode: "K7M4Q8",
        pin: "123456",
      }),
    CircleMemberAuthenticationError,
  );
});

test("an unknown circleCode with no matching row fails generically, same as a wrong one", async () => {
  await assert.rejects(
    () =>
      verifyCircleMemberCredentials({
        circleCode: randomTestCircleCode(),
        memberCode: "K7M4Q8",
        pin: "123456",
      }),
    CircleMemberAuthenticationError,
  );
});

test("Personal Savings and custodian data are unchanged by this entire suite", async () => {
  // This runs before test.after's cleanup, so every owner this suite has
  // created so far is still present -- subtract them, the same convention
  // every prior fixture suite in this codebase uses for this exact check.
  const finalCounts = {
    users: (await prisma.user.count()) - ownedResourceIds.userIds.size,
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});
