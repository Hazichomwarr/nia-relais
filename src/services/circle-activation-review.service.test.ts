import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DraftCircleOwnerReadAuthorizationError,
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
  getDraftCircleActivationReview,
} from "@/src/services/circle-activation-review.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket. No TEST_DATABASE_URL required (nothing here is destructive).

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "ACTIVATION_REVIEW_TEST_OWNER", email: `${unique("activation-review-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

async function createFixtureCircle(
  ownerId: string,
  status: CircleStatus,
  overrides: {
    contributionAmount?: string;
    currency?: string;
    frequency?: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
    startDate?: Date;
  } = {},
) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("ActivationReviewTestCircle"),
      currency: overrides.currency ?? "USD",
      contributionAmount: overrides.contributionAmount ?? "50.00",
      frequency: overrides.frequency ?? "WEEKLY",
      startDate: overrides.startDate ?? new Date("2026-01-01T00:00:00.000Z"),
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
  input: { displayName: string; payoutOrder?: number | null; status?: "ACTIVE" | "REMOVED" },
) {
  return prisma.circleMember.create({
    data: {
      circleId,
      displayName: input.displayName,
      memberCode: unique("CODE").toUpperCase().replace(/[^A-F0-9]/g, "0").slice(0, 16).padEnd(16, "0"),
      pinHash: "not-a-real-hash",
      status: input.status ?? "ACTIVE",
      payoutOrder: input.payoutOrder ?? null,
      addedById: ownerId,
    },
    select: { id: true },
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

// A. owner can read own DRAFT review
test("A. the owner can read their own DRAFT circle's activation review", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "M1", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "M2", payoutOrder: 2 });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.circle.id, circleId);
});

// B. cross-owner/nonexistent access denied safely
test("B. a different owner is denied with a specific authorization error", async () => {
  const ownerA = await createOwner();
  const ownerB = await createOwner();
  const circleId = await createFixtureCircle(ownerA, "DRAFT");

  await assert.rejects(
    () => getDraftCircleActivationReview({ ownerId: ownerB, circleId }),
    DraftCircleOwnerReadAuthorizationError,
  );
});

test("B2. a nonexistent circleId is rejected as not found", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => getDraftCircleActivationReview({ ownerId, circleId: "cnonexistentcircleidxxxxxx" }),
    DraftCircleOwnerReadNotFoundError,
  );
});

// C. non-DRAFT review rejected
test("C. an ACTIVE circle's review is rejected -- this review is DRAFT-only", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE");

  await assert.rejects(
    () => getDraftCircleActivationReview({ ownerId, circleId }),
    DraftCircleOwnerReadNotDraftError,
  );
});

// D. minimum cohort blocker
test("D. fewer than 2 active members produces the INSUFFICIENT_MEMBERS blocker and is not eligible", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "Solo", payoutOrder: 1 });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.eligible, false);
  assert.ok(review.blockers.includes("INSUFFICIENT_MEMBERS"));
  assert.deepEqual(review.proposedRounds, []);
});

// E. incomplete-order blocker
test("E. an incomplete payout order produces the INCOMPLETE_PAYOUT_ORDER blocker and is not eligible", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "Ordered", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "Unordered", payoutOrder: null });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.eligible, false);
  assert.ok(review.blockers.includes("INCOMPLETE_PAYOUT_ORDER"));
  assert.equal(review.proposedRounds.length, 0);
});

// F. complete eligible review
test("F. a complete cohort with a full 1..N payout order is eligible with no blockers", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "First", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "Second", payoutOrder: 2 });
  await createFixtureMember(circleId, ownerId, { displayName: "Third", payoutOrder: 3 });
  // A REMOVED member with no payoutOrder must not affect eligibility.
  await createFixtureMember(circleId, ownerId, { displayName: "Gone", status: "REMOVED", payoutOrder: null });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.eligible, true);
  assert.deepEqual(review.blockers, []);
  assert.equal(review.activeMemberCount, 3);
  assert.equal(review.proposedRounds.length, 3);
});

// G/H/I. exact recurrence per frequency
test("G. WEEKLY proposed round due dates advance 7 days per round", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", {
    frequency: "WEEKLY",
    startDate: new Date("2026-01-05T00:00:00.000Z"),
  });
  await createFixtureMember(circleId, ownerId, { displayName: "A", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "B", payoutOrder: 2 });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.proposedRounds[0].dueDate, "2026-01-05T00:00:00.000Z");
  assert.equal(review.proposedRounds[1].dueDate, "2026-01-12T00:00:00.000Z");
});

test("H. BIWEEKLY proposed round due dates advance 14 days per round", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", {
    frequency: "BIWEEKLY",
    startDate: new Date("2026-01-05T00:00:00.000Z"),
  });
  await createFixtureMember(circleId, ownerId, { displayName: "A", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "B", payoutOrder: 2 });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.proposedRounds[1].dueDate, "2026-01-19T00:00:00.000Z");
});

test("I. MONTHLY preserves the original day of month and clamps at a shorter month end", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", {
    frequency: "MONTHLY",
    startDate: new Date("2026-01-31T00:00:00.000Z"),
  });
  await createFixtureMember(circleId, ownerId, { displayName: "A", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "B", payoutOrder: 2 });
  await createFixtureMember(circleId, ownerId, { displayName: "C", payoutOrder: 3 });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.proposedRounds[0].dueDate, "2026-01-31T00:00:00.000Z");
  assert.equal(review.proposedRounds[1].dueDate, "2026-02-28T00:00:00.000Z");
  assert.equal(review.proposedRounds[2].dueDate, "2026-03-31T00:00:00.000Z");
});

// J. exact Decimal totals
test("J. expected totals are computed with exact Decimal arithmetic, not floating point", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", { contributionAmount: "33.33" });
  await createFixtureMember(circleId, ownerId, { displayName: "A", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "B", payoutOrder: 2 });
  await createFixtureMember(circleId, ownerId, { displayName: "C", payoutOrder: 3 });

  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  assert.equal(review.expectedContributionPerMember, "33.33");
  // 33.33 * 3 members = 99.99 per round
  assert.equal(review.expectedCollectionPerRound, "99.99");
  // 99.99 * 3 rounds = 299.97 across the rotation
  assert.equal(review.expectedTotalAcrossRotation, "299.97");
  for (const round of review.proposedRounds) {
    assert.equal(round.expectedCollection, "99.99");
  }
});

// K. review creates no rounds/obligations
test("K. reading the review creates no PayoutRound or ContributionObligation rows", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT");
  await createFixtureMember(circleId, ownerId, { displayName: "A", payoutOrder: 1 });
  await createFixtureMember(circleId, ownerId, { displayName: "B", payoutOrder: 2 });

  await getDraftCircleActivationReview({ ownerId, circleId });
  await getDraftCircleActivationReview({ ownerId, circleId });

  const rounds = await prisma.payoutRound.count({ where: { circleId } });
  const obligations = await prisma.contributionObligation.count({ where: { circleId } });
  assert.equal(rounds, 0);
  assert.equal(obligations, 0);
});

test("no pinHash, memberCode-adjacent secrets, or session/rate-limit fields are referenced", () => {
  const servicePath = fileURLToPath(new URL("./circle-activation-review.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["pinHash", "failedPinAttempts", "lockedUntil", "credentialVersion", "tokenHash"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
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
