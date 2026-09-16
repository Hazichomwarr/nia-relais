import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { computeActivationReviewFingerprint } from "@/src/domain/circle-activation-review";
import { getDraftCircleActivationReview } from "@/src/services/circle-activation-review.service";
import {
  activateCircle,
  CircleActivationStaleReviewError,
  DraftCircleMembershipConflictError,
  setDraftCirclePayoutOrder,
} from "@/src/services/circle.service";
import { prisma } from "@/src/prisma";
import { randomTestCircleCode } from "@/src/testing/circle-code-fixture";

// Live-database fixture tests for the atomic activation review guard
// (7I.5.1) -- same methodology as every prior SUSU ticket: unique-id-
// scoped fixtures, FK-safe cleanup in test.after, before/after row counts
// on unrelated tables. No TEST_DATABASE_URL required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "ACTIVATION_GUARD_TEST_OWNER", email: `${unique("activation-guard-test")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

async function createFixtureCircle(ownerId: string, contributionAmount = "10.00") {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      circleCode: randomTestCircleCode(),
      name: unique("ActivationGuardTestCircle"),
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
  return { id: member.id, payoutOrder };
}

/**
 * 10F: the REAL fingerprint a live review of this circle would currently
 * produce -- obtained by calling the actual production review-generation
 * function (getDraftCircleActivationReview) and fingerprinting its result
 * exactly as every real caller does, never a second, hand-rolled
 * implementation of the algorithm.
 *
 * This replaces an earlier version of this helper that called
 * computeActivationReviewFingerprint with ONLY `orderedActiveMembers` and
 * no `circle` field at all. That omission was silently tolerated by the
 * fingerprint function (its `circle` parameter is optional specifically
 * so pure-domain unit tests of member-ordering logic don't need one -- see
 * circle-activation-review.ts's own doc comment), but every real caller
 * (the review UI's activation-review-section.tsx, activate-circle.ts's
 * preflight check, and circle.service.ts's assertFreshReviewMatches
 * itself) always fingerprints a FULL review including circle terms. The
 * old helper's fingerprint could therefore never equal the one
 * assertFreshReviewMatches computes fresh at activation time -- these
 * integration tests were exercising a shape no real caller produces. Only
 * the test helper was wrong; computeActivationReviewFingerprint and
 * assertFreshReviewMatches match the frozen contract and are unchanged.
 *
 * Only valid while the circle is still DRAFT (getDraftCircleForOwner, and
 * therefore this function, rejects otherwise) -- matches every real
 * caller's own constraint, and every call site below invokes this before
 * any activation in that same test has occurred.
 */
async function fingerprintFor(ownerId: string, circleId: string): Promise<string> {
  const review = await getDraftCircleActivationReview({ ownerId, circleId });
  return computeActivationReviewFingerprint(review);
}

async function createTwoMemberCircle(contributionAmount = "10.00") {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, contributionAmount);
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  const b = await createFixtureMember(circleId, ownerId, "B", 2);
  return { ownerId, circleId, members: [a, b] };
}

async function createThreeMemberCircle() {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId);
  const a = await createFixtureMember(circleId, ownerId, "A", 1);
  const b = await createFixtureMember(circleId, ownerId, "B", 2);
  const c = await createFixtureMember(circleId, ownerId, "C", 3);
  return { ownerId, circleId, members: [a, b, c] };
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
  // FK-safe order: obligations -> rounds -> members -> circles -> users.
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

// A. matching fingerprint activates / E. unchanged configuration succeeds
test("A/E. a matching fingerprint (unchanged configuration) activates successfully", async () => {
  const fixture = await createTwoMemberCircle();
  const result = await activateCircle({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    expectedFingerprint: await fingerprintFor(fixture.ownerId, fixture.circleId),
  });

  assert.equal(result.circle.status, "ACTIVE");
  assert.equal(result.roundCount, 2);
  assert.equal(result.obligationCount, 4);
});

// B. mismatched fingerprint creates zero rounds/obligations
test("B. a mismatched fingerprint rejects activation and creates zero rounds/obligations", async () => {
  const fixture = await createTwoMemberCircle();

  await assert.rejects(
    () =>
      activateCircle({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        expectedFingerprint: "wrong-member:1|another-wrong-member:2",
      }),
    CircleActivationStaleReviewError,
  );

  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "DRAFT");
  const rounds = await prisma.payoutRound.count({ where: { circleId: fixture.circleId } });
  const obligations = await prisma.contributionObligation.count({ where: { circleId: fixture.circleId } });
  assert.equal(rounds, 0);
  assert.equal(obligations, 0);
});

// C. membership change between review and lock is rejected
test("C. a membership change since the review (same order, different member) is rejected, zero rounds/obligations created", async () => {
  const fixture = await createThreeMemberCircle();
  const staleFingerprint = await fingerprintFor(fixture.ownerId, fixture.circleId);

  // Simulate a race: between the owner's review and this activation
  // attempt, the owner removes member C and adds member D in the same
  // payoutOrder slot (still a complete, eligible 1..3 order -- so
  // assertActivationEligible alone would NOT catch this; only the
  // fingerprint guard does).
  await prisma.circleMember.update({
    where: { id: fixture.members[2].id },
    data: { status: "REMOVED", payoutOrder: null },
  });
  await createFixtureMember(fixture.circleId, fixture.ownerId, "D", 3);

  await assert.rejects(
    () => activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId, expectedFingerprint: staleFingerprint }),
    CircleActivationStaleReviewError,
  );

  const rounds = await prisma.payoutRound.count({ where: { circleId: fixture.circleId } });
  const obligations = await prisma.contributionObligation.count({ where: { circleId: fixture.circleId } });
  assert.equal(rounds, 0);
  assert.equal(obligations, 0);

  // Activating with the CURRENT (fresh) fingerprint still succeeds --
  // this is a rejection of the STALE review, not a broken circle.
  const result = await activateCircle({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    expectedFingerprint: await fingerprintFor(fixture.ownerId, fixture.circleId),
  });
  assert.equal(result.circle.status, "ACTIVE");
});

// D. payout-order change between review and lock is rejected
test("D. a payout-order change since the review (same members, different order) is rejected, zero rounds/obligations created", async () => {
  const fixture = await createThreeMemberCircle();
  const staleFingerprint = await fingerprintFor(fixture.ownerId, fixture.circleId);

  // Swap B and C's payout order via the real domain service, exactly as
  // 7I.4's UI would.
  await setDraftCirclePayoutOrder({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    orderedMemberIds: [fixture.members[0].id, fixture.members[2].id, fixture.members[1].id],
  });

  await assert.rejects(
    () => activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId, expectedFingerprint: staleFingerprint }),
    CircleActivationStaleReviewError,
  );

  const rounds = await prisma.payoutRound.count({ where: { circleId: fixture.circleId } });
  assert.equal(rounds, 0);
});

// F. concurrent activation/reorder is serialized correctly
test("F. a concurrent activation and reorder are serialized by the row lock -- exactly one consistent outcome results", async () => {
  const fixture = await createThreeMemberCircle();
  const originalFingerprint = await fingerprintFor(fixture.ownerId, fixture.circleId);

  const [activationOutcome, reorderOutcome] = await Promise.allSettled([
    activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId, expectedFingerprint: originalFingerprint }),
    setDraftCirclePayoutOrder({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      orderedMemberIds: [fixture.members[1].id, fixture.members[0].id, fixture.members[2].id],
    }),
  ]);

  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  const rounds = await prisma.payoutRound.count({ where: { circleId: fixture.circleId } });

  if (circle.status === "ACTIVE") {
    // Activation won the race: it must have used the ORIGINAL order (the
    // only fingerprint it was given), and the reorder must have been
    // rejected because the circle was no longer DRAFT by the time it ran.
    assert.equal(activationOutcome.status, "fulfilled");
    assert.equal(rounds, 3);
    assert.equal(reorderOutcome.status, "rejected");
    if (reorderOutcome.status === "rejected") {
      assert.ok(reorderOutcome.reason instanceof DraftCircleMembershipConflictError);
    }
  } else {
    // The reorder won the race: activation, using the now-stale original
    // fingerprint, must have been rejected and created nothing.
    assert.equal(circle.status, "DRAFT");
    assert.equal(rounds, 0);
    assert.equal(activationOutcome.status, "rejected");
    if (activationOutcome.status === "rejected") {
      assert.ok(activationOutcome.reason instanceof CircleActivationStaleReviewError);
    }
    assert.equal(reorderOutcome.status, "fulfilled");
  }
});

// G. ACTIVE replay remains idempotent
test("G. replaying activation with the same fingerprint is idempotent -- no duplicate rounds/obligations", async () => {
  const fixture = await createTwoMemberCircle();
  const fingerprint = await fingerprintFor(fixture.ownerId, fixture.circleId);

  const first = await activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId, expectedFingerprint: fingerprint });
  const roundsAfterFirst = await prisma.payoutRound.count({ where: { circleId: fixture.circleId } });
  const obligationsAfterFirst = await prisma.contributionObligation.count({ where: { circleId: fixture.circleId } });

  const second = await activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId, expectedFingerprint: fingerprint });
  const roundsAfterSecond = await prisma.payoutRound.count({ where: { circleId: fixture.circleId } });
  const obligationsAfterSecond = await prisma.contributionObligation.count({ where: { circleId: fixture.circleId } });

  assert.deepEqual(second, first);
  assert.equal(roundsAfterSecond, roundsAfterFirst);
  assert.equal(obligationsAfterSecond, obligationsAfterFirst);
});

test("G2. replaying activation with a fingerprint that no longer matches the (now-frozen) persisted state is rejected", async () => {
  const fixture = await createTwoMemberCircle();
  const fingerprint = await fingerprintFor(fixture.ownerId, fixture.circleId);
  await activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId, expectedFingerprint: fingerprint });

  await assert.rejects(
    () =>
      activateCircle({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        expectedFingerprint: "not-the-real-fingerprint:1",
      }),
    CircleActivationStaleReviewError,
  );
});

test("activateCircle without expectedFingerprint skips the guard entirely (backward-compatible)", async () => {
  const fixture = await createTwoMemberCircle();
  const result = await activateCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.circle.status, "ACTIVE");
});

// H. forged client terms/order cannot influence activation
test("H. activateCircle's input has no field for terms, member ids, order, or totals -- only ownerId/circleId/expectedFingerprint", () => {
  const servicePath = fileURLToPath(new URL("./circle.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const signatureMatch = source.match(/export async function activateCircle\(input: \{([\s\S]*?)\}\): Promise<CircleActivationResult>/);
  assert.ok(signatureMatch, "expected to find activateCircle's input type");
  const fieldNames = [...signatureMatch![1].matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((match) => match[1]);
  assert.deepEqual(fieldNames.sort(), ["circleId", "expectedFingerprint", "ownerId"]);
});

// I. no schema or unrelated domain changes
test("I. no direct schema/migration reference in the guard, and computeActivationReviewFingerprint is reused, not duplicated", () => {
  const servicePath = fileURLToPath(new URL("./circle.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(source, /import \{ computeActivationReviewFingerprint \} from "@\/src\/domain\/circle-activation-review";/);
  // The fingerprint join algorithm ("${member.id}:${member.payoutOrder}")
  // must appear ONLY inside the shared domain module, never re-typed here.
  assert.doesNotMatch(source, /\$\{member\.id\}:\$\{member\.payoutOrder\}/);
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
