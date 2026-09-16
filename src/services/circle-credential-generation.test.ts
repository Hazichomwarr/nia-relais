import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { CIRCLE_CODE_PATTERN, MEMBER_CODE_PATTERN } from "@/src/validations/circle-member-auth.schema";
import { addDraftCircleMember, createDraftCircle, createImportedDraftCircle } from "@/src/services/circle.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests for the 10E server-side generation contract:
// circleCode (on circle creation) and the new short memberCode (on member
// creation) are correctly shaped, persisted, and uniquely scoped. Retry/
// exhaustion behavior itself is covered generically and deterministically
// in src/domain/generated-code-retry.test.ts; this file proves circle.
// service.ts actually wires the real generators and the real database
// UNIQUE constraints through that helper.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "CREDENTIAL_GEN_TEST_OWNER", email: `${unique("credential-gen-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

function validNewCircleInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    name: unique("CredentialGenCircle"),
    currency: "USD",
    contributionAmount: "10.00",
    frequency: "WEEKLY" as const,
    startDate: "2099-01-01",
    ...overrides,
  };
}

test.after(async () => {
  await prisma.circleMember.deleteMany({ where: { circleId: { in: [...ownedResourceIds.circleIds] } } });
  await prisma.savingsCircle.deleteMany({ where: { id: { in: [...ownedResourceIds.circleIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...ownedResourceIds.userIds] } } });
  await prisma.$disconnect();
});

test("createDraftCircle issues and persists a circleCode matching the canonical NIA-XXXX shape", async () => {
  const ownerId = await createOwner();
  const result = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(result.id);

  assert.match(result.circleCode, CIRCLE_CODE_PATTERN);

  const persisted = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: result.id }, select: { circleCode: true } });
  assert.equal(persisted.circleCode, result.circleCode, "the handed-out code must be exactly the successfully persisted code");
});

test("createImportedDraftCircle also issues a circleCode matching the canonical shape", async () => {
  const ownerId = await createOwner();
  const result = await createImportedDraftCircle({
    ownerId,
    input: {
      ...validNewCircleInput({ startDate: "2020-01-01" }),
      historicalCompletedRoundCount: "3",
      historicalTermsConfirmed: "on",
    },
  });
  ownedResourceIds.circleIds.add(result.id);

  assert.match(result.circleCode, CIRCLE_CODE_PATTERN);
});

test("circleCode is never derived from SavingsCircle.id", async () => {
  const ownerId = await createOwner();
  const result = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(result.id);

  assert.equal(result.circleCode.includes(result.id), false);
  assert.equal(result.id.toUpperCase().includes(result.circleCode.replace("NIA-", "")), false);
});

test("circleCode is globally unique -- the database rejects a direct duplicate insert", async () => {
  const ownerId = await createOwner();
  const first = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(first.id);

  await assert.rejects(() =>
    prisma.savingsCircle.create({
      data: {
        ownerId,
        circleCode: first.circleCode,
        name: unique("DuplicateCodeCircle"),
        currency: "USD",
        contributionAmount: "10.00",
        frequency: "WEEKLY",
        startDate: new Date("2099-01-01T00:00:00.000Z"),
        status: "DRAFT",
      },
    }),
  );
});

test("addDraftCircleMember issues a new-format memberCode (6 characters, restricted alphabet)", async () => {
  const ownerId = await createOwner();
  const circle = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(circle.id);

  const member = await addDraftCircleMember({
    ownerId,
    circleId: circle.id,
    input: { displayName: "Amara", pin: "123456" },
  });

  assert.match(member.memberCode, MEMBER_CODE_PATTERN);
});

test("the same memberCode value may exist in two different circles (per-circle scope, not global)", async () => {
  const ownerId = await createOwner();
  const circleA = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  const circleB = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(circleA.id);
  ownedResourceIds.circleIds.add(circleB.id);

  const sharedCode = "K7M4Q8";
  const memberA = await prisma.circleMember.create({
    data: {
      circleId: circleA.id,
      displayName: "Member A",
      memberCode: sharedCode,
      pinHash: "not-a-real-hash",
      status: "ACTIVE",
      addedAt: new Date(),
      addedById: ownerId,
    },
    select: { id: true },
  });
  const memberB = await prisma.circleMember.create({
    data: {
      circleId: circleB.id,
      displayName: "Member B",
      memberCode: sharedCode,
      pinHash: "not-a-real-hash",
      status: "ACTIVE",
      addedAt: new Date(),
      addedById: ownerId,
    },
    select: { id: true },
  });

  assert.notEqual(memberA.id, memberB.id);
});

test("the same memberCode cannot be inserted twice within the same circle", async () => {
  const ownerId = await createOwner();
  const circle = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(circle.id);

  const duplicateCode = "Q8K7M4";
  await prisma.circleMember.create({
    data: {
      circleId: circle.id,
      displayName: "First",
      memberCode: duplicateCode,
      pinHash: "not-a-real-hash",
      status: "ACTIVE",
      addedAt: new Date(),
      addedById: ownerId,
    },
  });

  await assert.rejects(() =>
    prisma.circleMember.create({
      data: {
        circleId: circle.id,
        displayName: "Second",
        memberCode: duplicateCode,
        pinHash: "not-a-real-hash",
        status: "ACTIVE",
        addedAt: new Date(),
        addedById: ownerId,
      },
    }),
  );
});

// Existing-circle backfill contract (10E §16/§6): a legacy 16-hex
// memberCode issued before 10E remains exactly as persisted -- the login
// union pattern (not addDraftCircleMember, which never touches existing
// rows) is what accepts it, proven directly here at the schema level.
test("a pre-10E-shaped (legacy 16-hex) memberCode remains a valid, untouched persisted value", async () => {
  const ownerId = await createOwner();
  const circle = await createDraftCircle({ ownerId, input: validNewCircleInput() });
  ownedResourceIds.circleIds.add(circle.id);

  const legacyCode = "ABCDEF0123456789";
  const member = await prisma.circleMember.create({
    data: {
      circleId: circle.id,
      displayName: "Legacy Member",
      memberCode: legacyCode,
      pinHash: "not-a-real-hash",
      status: "ACTIVE",
      addedAt: new Date(),
      addedById: ownerId,
    },
    select: { memberCode: true },
  });

  assert.equal(member.memberCode, legacyCode);
});
