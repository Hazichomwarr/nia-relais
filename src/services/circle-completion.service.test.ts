import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { activateCircle } from "@/src/services/circle.service";
import {
  CircleCompletionAuthorizationError,
  CircleCompletionIntegrityError,
  CircleCompletionNotActiveError,
  CircleCompletionNotFoundError,
  CircleCompletionRoundsIncompleteError,
  completeCircle,
} from "@/src/services/circle-completion.service";
import { confirmContribution } from "@/src/services/contribution-confirmation.service";
import { recordContribution } from "@/src/services/contribution-recording.service";
import { confirmPayout } from "@/src/services/payout-confirmation.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import { activateFirstRound, advanceRound } from "@/src/services/round-lifecycle.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests for the SUSU circle-completion service
// (7L.1), implementing the frozen 7L contract
// (docs/product/susu-circle-completion-audit.md). Same methodology as
// round-lifecycle.service.test.ts: unique-id-scoped fixtures, FK-ordered
// cleanup in test.after regardless of outcome, before/after row counts on
// unrelated domain tables. No TEST_DATABASE_URL required. Fixtures use the
// real, already-shipped activateCircle/activateFirstRound/advanceRound/
// recordContribution/confirmContribution/recordPayout/confirmPayout
// services throughout to reach a genuinely, financially closed rotation --
// never hand-inserted financial rows for that part. A handful of tests
// (explicitly labeled below) deliberately bypass those services with a
// direct prisma.*.update call to simulate raw persistence corruption no
// service could ever produce -- these are the only writes in this file
// that do not go through a real domain service.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

/**
 * Asserts two completion results describe the identical persisted
 * transition (same completedAt, same completedById) while deliberately
 * ignoring the `replayed` flag itself -- a fresh completion and its own
 * subsequent replay (or two concurrent callers where one wins fresh and
 * the other observes it as a replay) are expected to differ in `replayed`
 * alone; everything else must be byte-identical.
 */
function assertSameCompletion<T extends { replayed: boolean }>(actual: T, expected: T) {
  assert.deepEqual({ ...actual, replayed: undefined }, { ...expected, replayed: undefined });
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "CIRCLE_COMPLETION_TEST_OWNER", email: `${unique("circle-completion-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

async function createFixtureCircle(ownerId: string, contributionAmount = "10.00", startDate = new Date("2026-01-01T00:00:00.000Z")) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("CircleCompletionTestCircle"),
      currency: "USD",
      contributionAmount,
      frequency: "WEEKLY",
      startDate,
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
  return member.id;
}

/**
 * A genuinely activated circle: DRAFT -> members added with a complete
 * payout order -> activateCircle (real service). Every round is created
 * UPCOMING, every obligation OPEN -- this helper performs no lifecycle
 * progression of its own.
 */
async function createActivatedCircle(memberCount = 3, contributionAmount = "10.00", startDate?: Date) {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, contributionAmount, startDate);
  const memberIds: string[] = [];
  for (let index = 0; index < memberCount; index += 1) {
    memberIds.push(await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1));
  }
  await activateCircle({ ownerId, circleId });

  const rounds = await prisma.payoutRound.findMany({ where: { circleId }, orderBy: { roundNumber: "asc" } });
  const totalAmount = (Number(contributionAmount) * memberCount).toFixed(2);

  return { ownerId, circleId, memberIds, rounds, contributionAmount, totalAmount };
}

/** Records and confirms every member's contribution for one round. */
async function fulfillContributions(ownerId: string, circleId: string, roundId: string, memberIds: readonly string[], amount: string) {
  for (const memberId of memberIds) {
    const obligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId, roundId, memberId } });
    const payment = await recordContribution({
      ownerId,
      circleId,
      input: { obligationId: obligation.id, amount, clientOperationId: unique("contrib-op") },
    });
    await confirmContribution({ ownerId, circleId, input: { paymentId: payment.id } });
  }
}

/** Records and confirms the round's payout, returning the confirmed payout row. */
async function recordAndConfirmPayout(ownerId: string, circleId: string, roundId: string, recipientId: string, amount: string) {
  const payout = await recordPayout({
    ownerId,
    circleId,
    input: { roundId, amount, clientOperationId: unique("payout-op") },
  });
  return confirmPayout({ circleId, memberId: recipientId, input: { payoutId: payout.id } });
}

/** Fulfills every financial precondition for closing one round: every
 * contribution confirmed, payout recorded and confirmed. */
async function makeRoundFinanciallyComplete(
  fixture: Awaited<ReturnType<typeof createActivatedCircle>>,
  round: { id: string; recipientId: string },
) {
  await fulfillContributions(fixture.ownerId, fixture.circleId, round.id, fixture.memberIds, fixture.contributionAmount);
  return recordAndConfirmPayout(fixture.ownerId, fixture.circleId, round.id, round.recipientId, fixture.totalAmount);
}

/**
 * Activates round 1 and closes every round in sequence through the real
 * activateFirstRound/advanceRound services -- the only way this test file
 * ever produces a fully-CLOSED rotation. Never hand-writes PayoutRound
 * status directly.
 */
async function closeAllRounds(fixture: Awaited<ReturnType<typeof createActivatedCircle>>) {
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  for (const round of fixture.rounds) {
    await makeRoundFinanciallyComplete(fixture, round);
    await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: round.id });
  }
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

// ===================================================================
// Fresh completion
// ===================================================================

test("completes a circle whose entire rotation has closed: ACTIVE -> COMPLETED, with fresh provenance", async () => {
  const fixture = await createActivatedCircle(3);
  await closeAllRounds(fixture);
  const before = new Date();

  const result = await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(result.replayed, false);
  assert.equal(result.circleId, fixture.circleId);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.completedById, fixture.ownerId);
  assert.ok(new Date(result.completedAt).getTime() >= before.getTime() - 1000);

  const persisted = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(persisted.status, "COMPLETED");
  assert.equal(persisted.completedById, fixture.ownerId);
  assert.equal(persisted.completedAt?.toISOString(), result.completedAt);
  // Untouched by completion, per the frozen contract.
  assert.equal(persisted.archivedAt, null);
  assert.equal(persisted.archivedById, null);
  assert.ok(persisted.activatedAt);
  assert.equal(persisted.activatedById, fixture.ownerId);
});

test("completedAt is a fresh, independent timestamp -- never derived from the final round's own closedAt", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  const finalRound = await prisma.payoutRound.findFirstOrThrow({ where: { circleId: fixture.circleId, roundNumber: 2 } });

  await new Promise((resolve) => setTimeout(resolve, 15));
  const result = await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.ok(finalRound.closedAt);
  assert.ok(
    new Date(result.completedAt).getTime() > finalRound.closedAt!.getTime(),
    "completedAt must postdate the final round's own closedAt, never equal or derived from it",
  );
});

test("round provenance is never rewritten by completion", async () => {
  const fixture = await createActivatedCircle(3);
  await closeAllRounds(fixture);
  const roundsBefore = await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } });
  const obligationsBefore = await prisma.contributionObligation.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });
  const paymentsBefore = await prisma.contributionPayment.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });
  const payoutsBefore = await prisma.payout.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } });

  await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.deepEqual(await prisma.payoutRound.findMany({ where: { circleId: fixture.circleId }, orderBy: { roundNumber: "asc" } }), roundsBefore);
  assert.deepEqual(await prisma.contributionObligation.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } }), obligationsBefore);
  assert.deepEqual(await prisma.contributionPayment.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } }), paymentsBefore);
  assert.deepEqual(await prisma.payout.findMany({ where: { circleId: fixture.circleId }, orderBy: { id: "asc" } }), payoutsBefore);
});

test("future due dates do not gate completion eligibility", async () => {
  const fixture = await createActivatedCircle(2, "10.00", new Date("2099-01-01T00:00:00.000Z"));
  await closeAllRounds(fixture);

  const result = await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.status, "COMPLETED");
});

// ===================================================================
// Not found / authorization
// ===================================================================

test("a nonexistent circle is rejected as not found", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => completeCircle({ ownerId, circleId: "does-not-exist" }),
    CircleCompletionNotFoundError,
  );
});

test("a wrong owner is denied, and the circle remains untouched", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () => completeCircle({ ownerId: otherOwnerId, circleId: fixture.circleId }),
    CircleCompletionAuthorizationError,
  );
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

// ===================================================================
// Not active
// ===================================================================

test("a DRAFT circle (never activated) is rejected as not-active, not as corruption", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId);
  await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureMember(circleId, ownerId, "B", 2);

  await assert.rejects(
    () => completeCircle({ ownerId, circleId }),
    CircleCompletionNotActiveError,
  );
});

for (const status of ["CANCELLED", "ARCHIVED"] as const) {
  test(`a fresh completeCircle is rejected once the circle is ${status}, never treated as replay`, async () => {
    const fixture = await createActivatedCircle(2);
    await closeAllRounds(fixture);
    // Direct write: no service in this codebase ever produces CANCELLED or
    // ARCHIVED (7L section 2/17) -- simulated here only to prove
    // completeCircle's own terminal-state handling for these otherwise
    // unreachable values, mirroring round-lifecycle.service.test.ts's own
    // identical technique for the same reason.
    await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status } });

    await assert.rejects(
      () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
      CircleCompletionNotActiveError,
    );
    const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
    assert.equal(circle.status, status, "must never be overwritten to COMPLETED");
  });
}

// ===================================================================
// Rounds incomplete (ordinary business state, never corruption)
// ===================================================================

test("an ACTIVE circle whose rotation has not started yet is rejected as rounds-incomplete", async () => {
  const fixture = await createActivatedCircle(3);

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionRoundsIncompleteError,
  );
});

test("an ACTIVE circle mid-rotation (some CLOSED, one ACTIVE, rest UPCOMING) is rejected as rounds-incomplete", async () => {
  const fixture = await createActivatedCircle(3);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionRoundsIncompleteError,
  );
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

test("the final round being financially ready but not yet CLOSED is still rounds-incomplete, not corruption", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);
  // Round 2 (final) is now financially complete but deliberately not
  // advanced/closed yet.

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionRoundsIncompleteError,
  );
});

// ===================================================================
// Structural / financial corruption (never disguised as "rounds
// incomplete")
// ===================================================================

test("a broken round-number sequence is rejected as an integrity error, not rounds-incomplete", async () => {
  const fixture = await createActivatedCircle(3);
  await closeAllRounds(fixture);
  // Direct write: simulates raw persistence corruption no service could
  // ever produce -- creates a gap (1, 2, 4) while keeping the unique
  // (circleId, roundNumber) index satisfied.
  await prisma.payoutRound.update({ where: { id: fixture.rounds[2].id }, data: { roundNumber: 4 } });

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionIntegrityError,
  );
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE", "corruption must never be silently written as COMPLETED");
});

test("a CLOSED round missing closedById is rejected as an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  // Direct write: simulates raw persistence corruption -- no service ever
  // closes a round without setting closedById in the same write.
  await prisma.payoutRound.update({ where: { id: fixture.rounds[0].id }, data: { closedById: null } });

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionIntegrityError,
  );
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

test("a CLOSED round whose contribution ledger no longer agrees with its FULFILLED status is rejected as an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  const round1Obligation = await prisma.contributionObligation.findFirstOrThrow({
    where: { circleId: fixture.circleId, roundId: fixture.rounds[0].id },
  });
  // Direct write: downgrades a CONFIRMED payment to REJECTED without going
  // through rejectContribution (which would itself reopen the obligation)
  // -- simulates the obligation's persisted FULFILLED status silently
  // disagreeing with its own confirmed-payment ledger, exactly the
  // corruption assessContributionClosureReadiness exists to catch.
  await prisma.contributionPayment.updateMany({
    where: { circleId: fixture.circleId, obligationId: round1Obligation.id, status: "CONFIRMED" },
    data: { status: "REJECTED" },
  });

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionIntegrityError,
  );
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

test("a CLOSED round whose CONFIRMED payout amount has drifted from the frozen expected amount is rejected as an integrity error", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  // Direct write: simulates a CONFIRMED payout's amount silently drifting
  // from the round's own frozen expected total -- exactly the corruption
  // assessPayoutClosureReadiness exists to catch.
  await prisma.payout.updateMany({
    where: { circleId: fixture.circleId, roundId: fixture.rounds[0].id },
    data: { amount: new Prisma.Decimal("999999.99") },
  });

  await assert.rejects(
    () => completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    CircleCompletionIntegrityError,
  );
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

// ===================================================================
// Replay
// ===================================================================

test("an exact same-owner replay of an already-COMPLETED circle performs zero writes and reports the original provenance", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  const first = await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const before = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });

  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const after = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });

  assertSameCompletion(second, first);
  assert.equal(second.replayed, true);
  assert.equal(after.completedAt?.getTime(), before.completedAt?.getTime());
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "a replay must not write the row at all");
});

test("a non-owner caller observing an already-COMPLETED circle is denied, never treated as replay", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () => completeCircle({ ownerId: otherOwnerId, circleId: fixture.circleId }),
    CircleCompletionAuthorizationError,
  );
});

// ===================================================================
// Post-completion financial behavior
// ===================================================================

test("post-completion, exact-intent contribution/payout replay and terminal-decision replay remain valid", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  const round1 = fixture.rounds[0];
  const existingPayment = await prisma.contributionPayment.findFirstOrThrow({
    where: { circleId: fixture.circleId, obligation: { roundId: round1.id } },
  });
  const existingPayout = await prisma.payout.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id } });

  await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  // Exact-intent replay: same clientOperationId, same obligation/round, same amount.
  const contributionReplay = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: existingPayment.obligationId, amount: fixture.contributionAmount, clientOperationId: existingPayment.clientOperationId },
  });
  assert.equal(contributionReplay.id, existingPayment.id);

  const payoutReplay = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: round1.id, amount: fixture.totalAmount, clientOperationId: existingPayout.clientOperationId },
  });
  assert.equal(payoutReplay.id, existingPayout.id);

  // Terminal-decision replay: confirming an already-CONFIRMED payment/payout again.
  const contributionDecisionReplay = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: existingPayment.id },
  });
  assert.equal(contributionDecisionReplay.payment.status, "CONFIRMED");

  const payoutDecisionReplay = await confirmPayout({
    circleId: fixture.circleId,
    memberId: round1.recipientId,
    input: { payoutId: existingPayout.id },
  });
  assert.equal(payoutDecisionReplay.status, "CONFIRMED");
});

test("post-completion, a genuinely fresh contribution/payout mutation is rejected because the circle is no longer ACTIVE", async () => {
  const fixture = await createActivatedCircle(2);
  await closeAllRounds(fixture);
  const round1 = fixture.rounds[0];
  const anyObligation = await prisma.contributionObligation.findFirstOrThrow({ where: { circleId: fixture.circleId, roundId: round1.id } });

  await completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  await assert.rejects(
    () => recordContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { obligationId: anyObligation.id, amount: fixture.contributionAmount, clientOperationId: unique("fresh-contrib-op") },
    }),
    (error: unknown) => error instanceof Error && error.name === "ContributionRecordingCircleNotActiveError",
  );

  await assert.rejects(
    () => recordPayout({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { roundId: round1.id, amount: fixture.totalAmount, clientOperationId: unique("fresh-payout-op") },
    }),
    (error: unknown) => error instanceof Error && error.name === "PayoutRecordingCircleNotActiveError",
  );
});

// ===================================================================
// Structural / lock-ordering source checks
// ===================================================================

test("completeCircle's own public signature takes only ownerId/circleId -- no round/member/payout identifier, and no member-session dependency", () => {
  const source = readFileSync(new URL("./circle-completion.service.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /memberId/);
  assert.doesNotMatch(source, /payoutId/);
  assert.doesNotMatch(source, /clientOperationId/);
  // completeCircle's own exported params shape -- ownerId/circleId only.
  // (`.roundId` legitimately appears elsewhere in this file, grouping each
  // round's own obligations/payout by their foreign key during financial
  // revalidation -- that is reading persisted data, not a public
  // round-identifying input this service accepts.)
  assert.match(
    source,
    /export async function completeCircle\(params: \{\s*ownerId: string;\s*circleId: string;\s*\}\)/,
  );
});

test("completeCircle acquires the shared SavingsCircle lock via the unmodified lockSavingsCircleForUpdate primitive", () => {
  const source = readFileSync(new URL("./circle-completion.service.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(source, /import \{ lockSavingsCircleForUpdate \} from "@\/src\/repositories\/circle-lock\.repository";/);
  assert.match(source, /lockSavingsCircleForUpdate\(/);
  assert.doesNotMatch(source, /\$queryRaw/);
});

test("this module's only mutation is the CAS write of status/completedAt/completedById -- never archivedAt/archivedById, and never any other table", () => {
  const source = readFileSync(new URL("../repositories/circle-completion.repository.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  // Exactly one mutating call in the whole file: savingsCircle.updateMany,
  // inside completeActiveCircle. archivedAt/archivedById legitimately
  // appear elsewhere in this file (in the READ select, so provenance
  // coherence can be checked) -- this asserts they never appear inside the
  // one WRITE function's own body specifically.
  const updateCalls = source.match(/\.\w+\.(update|updateMany|create|createMany|delete|deleteMany)\(/g) ?? [];
  assert.deepEqual(updateCalls, [".savingsCircle.updateMany("], "the only mutating Prisma call in this file must be the one guarded status CAS write");

  const mutationBody = source.slice(source.indexOf("export function completeActiveCircle"));
  assert.doesNotMatch(mutationBody, /archivedAt/);
  assert.doesNotMatch(mutationBody, /archivedById/);
  assert.match(mutationBody, /status: "COMPLETED"/);
  assert.match(mutationBody, /completedAt: input\.completedAt/);
  assert.match(mutationBody, /completedById: input\.ownerId/);
});

// ===================================================================
// Concurrency (real Postgres)
// ===================================================================

test("two concurrent completeCircle calls (same owner) resolve to exactly one physical transition", async () => {
  const fixture = await createActivatedCircle(3);
  await closeAllRounds(fixture);

  const results = await Promise.allSettled([
    completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent calls must resolve safely");
  }
  const values = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  assertSameCompletion(values[0]!, values[1]!);
  const replayedFlags = values.map((value) => value!.replayed).sort();
  assert.deepEqual(replayedFlags, [false, true], "exactly one caller must observe the fresh transition, the other a replay");

  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "COMPLETED");
});

test("completeCircle racing the final advanceRound: both resolve safely, and completion never both closes the final round and completes the circle in one step", async () => {
  const fixture = await createActivatedCircle(2);
  await activateFirstRound({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[0]);
  await advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[0].id });
  await makeRoundFinanciallyComplete(fixture, fixture.rounds[1]);
  // Round 2 (final) is now ACTIVE and financially ready to close, but not
  // yet closed -- the exact contested state this race is about.

  const results = await Promise.allSettled([
    advanceRound({ ownerId: fixture.ownerId, circleId: fixture.circleId, roundId: fixture.rounds[1].id }),
    completeCircle({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
  ]);

  const advanceOutcome = results[0];
  const completeOutcome = results[1];
  assert.equal(advanceOutcome.status, "fulfilled", "advancing the final round must always succeed regardless of race order");

  const round2After = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.rounds[1].id } });
  assert.equal(round2After.status, "CLOSED", "the final round must be CLOSED once both contenders have settled, either way");

  const circleAfter = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  if (completeOutcome.status === "fulfilled") {
    // completion acquired the lock AFTER advanceRound committed --
    // legitimately completable by then.
    assert.equal(circleAfter.status, "COMPLETED");
  } else {
    // completion acquired the lock BEFORE advanceRound committed -- failed
    // safely on the still-ACTIVE final round, never automatically chained.
    assert.ok(completeOutcome.reason instanceof CircleCompletionRoundsIncompleteError);
    assert.equal(circleAfter.status, "ACTIVE", "the circle must remain ACTIVE -- the owner must explicitly retry completion");
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
