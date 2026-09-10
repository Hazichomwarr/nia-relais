import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";
import { confirmPayout } from "@/src/services/payout-confirmation.service";
import { disputePayout } from "@/src/services/payout-dispute.service";
import {
  OwnerPayoutsAuthorizationError,
  OwnerPayoutsCircleNotEligibleError,
  OwnerPayoutsCircleNotFoundError,
  OwnerPayoutsIntegrityError,
  getOwnerCirclePayouts,
} from "@/src/services/payout-owner-read.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as
// contribution-owner-read.service.test.ts / payout-confirmation.service
// .test.ts: unique-id-scoped fixtures, FK-ordered cleanup in test.after
// regardless of outcome, before/after row counts on unrelated domain
// tables. No TEST_DATABASE_URL required. Fixtures use the real,
// already-shipped recordPayout/confirmPayout/disputePayout (7K.3/7K.4/
// 7K.5) to produce genuine RECORDED/CONFIRMED/DISPUTED payouts rather
// than hand-inserting them.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "PAYOUT_OWNER_READ_TEST_OWNER", email: `${unique("payout-owner-read-test-owner")}@example.invalid` },
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
      name: unique("PayoutOwnerReadTestCircle"),
      currency,
      contributionAmount,
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status: status === "DRAFT" ? "DRAFT" : "ACTIVE",
      activatedAt: status === "DRAFT" ? null : new Date("2026-01-01T00:00:00.000Z"),
      activatedById: status === "DRAFT" ? null : ownerId,
    },
    select: { id: true },
  });
  ownedResourceIds.circleIds.add(circle.id);
  if (status !== "DRAFT" && status !== "ACTIVE") {
    await prisma.savingsCircle.update({ where: { id: circle.id }, data: { status } });
  }
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
    select: { id: true, memberCode: true, displayName: true },
  });
  return member;
}

async function createFixtureRound(
  circleId: string,
  input: { roundNumber: number; recipientId: string; dueDate?: Date; status?: "UPCOMING" | "ACTIVE" | "CLOSED" },
) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: input.dueDate ?? new Date("2026-01-08T00:00:00.000Z"),
      status: input.status ?? "UPCOMING",
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
 * A ready-to-record ACTIVE circle: one owner, `memberAmounts.length`
 * members, one round (recipient = the first member), and exactly one
 * obligation per member for that round -- the activation-time shape whose
 * frozen sum IS the round's authoritative expected payout.
 */
async function createActiveCircleWithRound(options?: {
  memberAmounts?: readonly string[];
  currencies?: readonly string[];
  currency?: string;
  roundNumber?: number;
  dueDate?: Date;
}) {
  const memberAmounts = options?.memberAmounts ?? ["25.00"];
  const currency = options?.currency ?? "USD";
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", memberAmounts[0], currency);

  const memberIds: string[] = [];
  for (const [index] of memberAmounts.entries()) {
    memberIds.push((await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1)).id);
  }

  const dueDate = options?.dueDate ?? new Date("2026-01-08T00:00:00.000Z");
  const roundId = await createFixtureRound(circleId, {
    roundNumber: options?.roundNumber ?? 1,
    recipientId: memberIds[0],
    dueDate,
  });

  const obligationIds: string[] = [];
  for (const [index, expectedAmount] of memberAmounts.entries()) {
    obligationIds.push(
      await createFixtureObligation(circleId, roundId, memberIds[index], {
        expectedAmount,
        currency: options?.currencies?.[index] ?? currency,
        dueDate,
      }),
    );
  }

  const total = memberAmounts.reduce((sum, value) => sum + Number(value), 0).toFixed(2);
  return { ownerId, circleId, roundId, memberIds, obligationIds, recipientId: memberIds[0], total };
}

async function recordFixturePayout(fixture: Awaited<ReturnType<typeof createActiveCircleWithRound>>) {
  return recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: fixture.total, clientOperationId: unique("op") },
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
// Authorization / lifecycle
// -------------------------------------------------------------------

test("the owner can read their own ACTIVE circle's payout history", async () => {
  const fixture = await createActiveCircleWithRound();
  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.equal(result.circle.id, fixture.circleId);
  assert.equal(result.circle.status, "ACTIVE");
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0]?.id, fixture.roundId);
});

test("a cross-owner request is denied with OwnerPayoutsAuthorizationError", async () => {
  const fixture = await createActiveCircleWithRound();
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: otherOwnerId, circleId: fixture.circleId }),
    OwnerPayoutsAuthorizationError,
  );
});

test("a nonexistent circle is rejected with OwnerPayoutsCircleNotFoundError", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId, circleId: "not-a-real-circle-id" }),
    OwnerPayoutsCircleNotFoundError,
  );
});

test("a DRAFT circle is rejected with OwnerPayoutsCircleNotEligibleError", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", "10.00");

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId, circleId }),
    OwnerPayoutsCircleNotEligibleError,
  );
});

test("a CANCELLED circle is rejected with OwnerPayoutsCircleNotEligibleError", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "CANCELLED", "10.00");

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId, circleId }),
    OwnerPayoutsCircleNotEligibleError,
  );
});

test("a COMPLETED circle's payout history remains readable", async () => {
  const fixture = await createActiveCircleWithRound();
  await recordFixturePayout(fixture);
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.circle.status, "COMPLETED");
  assert.equal(result.rounds[0]?.payout?.status, "RECORDED");
});

test("an ARCHIVED circle's payout history remains readable", async () => {
  const fixture = await createActiveCircleWithRound();
  await recordFixturePayout(fixture);
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "ARCHIVED" } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.circle.status, "ARCHIVED");
  assert.equal(result.rounds[0]?.payout?.status, "RECORDED");
});

// -------------------------------------------------------------------
// Round authority
// -------------------------------------------------------------------

test("persisted roundNumber/dueDate/status are returned verbatim, and the recipient is derived from recipientId", async () => {
  const fixture = await createActiveCircleWithRound({ dueDate: new Date("2026-03-15T00:00:00.000Z") });
  await prisma.payoutRound.update({ where: { id: fixture.roundId }, data: { status: "CLOSED" } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const round = result.rounds[0]!;
  assert.equal(round.roundNumber, 1);
  assert.equal(round.dueDate, new Date("2026-03-15T00:00:00.000Z").toISOString());
  assert.equal(round.status, "CLOSED");
  assert.equal(round.recipient.memberId, fixture.recipientId);
});

test("the recipient is never reconstructed from current payoutOrder -- even if it changes after activation", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  // The recipient's payoutOrder is mutated after the fact; the round's
  // own persisted recipientId must remain authoritative regardless.
  await prisma.circleMember.update({ where: { id: fixture.recipientId }, data: { payoutOrder: 99 } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.recipient.memberId, fixture.recipientId);
  assert.equal(result.rounds[0]?.recipient.payoutOrder, 99, "payoutOrder is read live from the member row, but recipient identity is not derived from it");
});

test("rounds are returned in deterministic roundNumber-ascending order, regardless of creation order", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberIds = [
    (await createFixtureMember(circleId, ownerId, "A", 1)).id,
    (await createFixtureMember(circleId, ownerId, "B", 2)).id,
    (await createFixtureMember(circleId, ownerId, "C", 3)).id,
  ];
  // Created out of order: round 3, then 1, then 2.
  const roundThree = await createFixtureRound(circleId, { roundNumber: 3, recipientId: memberIds[2] });
  const roundOne = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberIds[0] });
  const roundTwo = await createFixtureRound(circleId, { roundNumber: 2, recipientId: memberIds[1] });
  for (const roundId of [roundOne, roundTwo, roundThree]) {
    for (const memberId of memberIds) {
      await createFixtureObligation(circleId, roundId, memberId, { expectedAmount: "10.00" });
    }
  }

  const result = await getOwnerCirclePayouts({ ownerId, circleId });
  assert.deepEqual(
    result.rounds.map((round) => round.roundNumber),
    [1, 2, 3],
  );
});

// -------------------------------------------------------------------
// Expected payout
// -------------------------------------------------------------------

test("expected payout for a single obligation equals that obligation's expected amount", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00"] });
  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.expectedPayout.amount, "25.00");
  assert.equal(result.rounds[0]?.expectedPayout.currency, "USD");
});

test("expected payout for multiple obligations is their exact Decimal sum, never a floating-point approximation", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["33.33", "33.33", "33.33"] });
  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.expectedPayout.amount, "99.99", "33.33 x 3 must be exactly 99.99, never 100.00");
});

test("expected payout currency follows the obligations, e.g. XOF", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["5000.00", "5000.00"], currency: "XOF" });
  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.expectedPayout.currency, "XOF");
  assert.equal(result.rounds[0]?.expectedPayout.amount, "10000.00");
});

test("obligations disagreeing on currency for a round are rejected as an accounting integrity failure", async () => {
  const fixture = await createActiveCircleWithRound({
    memberAmounts: ["25.00", "25.00"],
    currencies: ["USD", "EUR"],
  });

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    PayoutAccountingIntegrityError,
  );
});

test("a round with no obligation history is rejected, never displayed as a zero-amount payout", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "25.00");
  const memberId = (await createFixtureMember(circleId, ownerId, "A", 1)).id;
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId });

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId, circleId }),
    PayoutAccountingIntegrityError,
  );
});

test("expected payout is never derived from the live member cohort", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  await createFixtureMember(fixture.circleId, fixture.ownerId, "LATE", 3);

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.expectedPayout.amount, "50.00", "a third, obligation-less member must not inflate the expected payout");
});

test("expected payout is never derived from the circle's current (mutable) contributionAmount", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { contributionAmount: "40.00" } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.expectedPayout.amount, "50.00");
});

// -------------------------------------------------------------------
// Payout statuses
// -------------------------------------------------------------------

test("an unrecorded round has payout: null", async () => {
  const fixture = await createActiveCircleWithRound();
  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.rounds[0]?.payout, null);
});

test("a RECORDED payout is returned with its recording provenance", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const payout = result.rounds[0]?.payout;
  assert.equal(payout?.id, recorded.id);
  assert.equal(payout?.status, "RECORDED");
  assert.equal(payout?.recordedById, fixture.ownerId);
  assert.equal(payout?.confirmedAt, null);
  assert.equal(payout?.disputedAt, null);
});

test("a CONFIRMED payout is returned with its confirmation provenance", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const payout = result.rounds[0]?.payout;
  assert.equal(payout?.status, "CONFIRMED");
  assert.equal(payout?.confirmedByMemberId, fixture.recipientId);
  assert.ok(payout?.confirmedAt);
  assert.equal(payout?.disputedAt, null);
});

test("a DISPUTED payout is returned with its dispute provenance, and disputeReason is preserved exactly -- never softened as 'pending correction'", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: recorded.id, disputeReason: "Funds were never received." },
  });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const payout = result.rounds[0]?.payout;
  assert.equal(payout?.status, "DISPUTED");
  assert.equal(payout?.disputedByMemberId, fixture.recipientId);
  assert.equal(payout?.disputeReason, "Funds were never received.");
  assert.ok(payout?.disputedAt);
  assert.equal(payout?.confirmedAt, null);
});

// -------------------------------------------------------------------
// Integrity
// -------------------------------------------------------------------

test("a persisted amount drift against frozen obligation history is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.payout.update({ where: { id: recorded.id }, data: { amount: "999.00" } });

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a persisted currency drift against the authoritative obligation currency is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.payout.update({ where: { id: recorded.id }, data: { currency: "EUR" } });

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray confirmation provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedAt" = now(), "confirmedByMemberId" = ${fixture.recipientId} WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray dispute provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${fixture.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a CONFIRMED payout missing confirmation provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedAt" = NULL WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a CONFIRMED payout whose confirmedByMemberId does not match the persisted recipient is rejected", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedByMemberId" = ${otherMemberId} WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a CONFIRMED payout carrying dispute provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${fixture.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a DISPUTED payout missing its reason is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: recorded.id, disputeReason: "Not received." },
  });
  await prisma.$executeRaw`UPDATE "Payout" SET "disputeReason" = NULL WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a DISPUTED payout whose disputedByMemberId does not match the persisted recipient is rejected", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];
  const recorded = await recordFixturePayout(fixture);
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: recorded.id, disputeReason: "Not received." },
  });
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedByMemberId" = ${otherMemberId} WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("a DISPUTED payout carrying confirmation provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: recorded.id, disputeReason: "Not received." },
  });
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedAt" = now(), "confirmedByMemberId" = ${fixture.recipientId} WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }),
    OwnerPayoutsIntegrityError,
  );
});

test("integrity failures are never auto-repaired -- the corrupted row is left exactly as found", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.payout.update({ where: { id: recorded.id }, data: { currency: "EUR" } });

  await assert.rejects(() => getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId }));

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });
  assert.equal(persisted.currency, "EUR", "the read model must never write to repair corrupted history");
});

// -------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------

test("summary counts are correct across a mix of unrecorded/RECORDED/CONFIRMED/DISPUTED rounds", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const contributorId = (await createFixtureMember(circleId, ownerId, "C", 1)).id;
  const recipients = [
    (await createFixtureMember(circleId, ownerId, "R1", 2)).id,
    (await createFixtureMember(circleId, ownerId, "R2", 3)).id,
    (await createFixtureMember(circleId, ownerId, "R3", 4)).id,
    (await createFixtureMember(circleId, ownerId, "R4", 5)).id,
  ];

  const roundIds: string[] = [];
  for (const [index, recipientId] of recipients.entries()) {
    const roundId = await createFixtureRound(circleId, { roundNumber: index + 1, recipientId });
    await createFixtureObligation(circleId, roundId, contributorId, { expectedAmount: "10.00" });
    await createFixtureObligation(circleId, roundId, recipientId, { expectedAmount: "10.00" });
    roundIds.push(roundId);
  }

  // round 1: left unrecorded.
  const recordedPayout = await recordPayout({
    ownerId,
    circleId,
    input: { roundId: roundIds[1], amount: "20.00", clientOperationId: unique("op-recorded") },
  });
  const confirmedPayout = await recordPayout({
    ownerId,
    circleId,
    input: { roundId: roundIds[2], amount: "20.00", clientOperationId: unique("op-confirmed") },
  });
  await confirmPayout({ circleId, memberId: recipients[2], input: { payoutId: confirmedPayout.id } });
  const disputedPayout = await recordPayout({
    ownerId,
    circleId,
    input: { roundId: roundIds[3], amount: "20.00", clientOperationId: unique("op-disputed") },
  });
  await disputePayout({ circleId, memberId: recipients[3], input: { payoutId: disputedPayout.id, disputeReason: "x" } });
  void recordedPayout;

  const result = await getOwnerCirclePayouts({ ownerId, circleId });
  assert.deepEqual(result.summary, {
    totalRounds: 4,
    recordedCount: 1,
    confirmedCount: 1,
    disputedCount: 1,
    unrecordedCount: 1,
  });
  assert.equal(
    result.summary.recordedCount +
      result.summary.confirmedCount +
      result.summary.disputedCount +
      result.summary.unrecordedCount,
    result.summary.totalRounds,
  );
});

test("recordedCount means RECORDED only -- a CONFIRMED payout does not also count as recorded", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  assert.equal(result.summary.recordedCount, 0);
  assert.equal(result.summary.confirmedCount, 1);
});

// -------------------------------------------------------------------
// Privacy
// -------------------------------------------------------------------

test("no PIN hash, auth counters, session, or raw User field is ever exposed", async () => {
  const fixture = await createActiveCircleWithRound();
  await recordFixturePayout(fixture);

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /pinHash/i);
  assert.doesNotMatch(serialized, /failedPinAttempts/i);
  assert.doesNotMatch(serialized, /lockedUntil/i);
  assert.doesNotMatch(serialized, /credentialVersion/i);
  assert.doesNotMatch(serialized, /session/i);
});

test("the result exposes only the whitelisted fields at every level", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  void recorded;

  const result = await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  assert.deepEqual(Object.keys(result).sort(), ["circle", "rounds", "summary"]);
  assert.deepEqual(Object.keys(result.circle).sort(), ["currency", "id", "name", "status"]);
  assert.deepEqual(
    Object.keys(result.rounds[0]!).sort(),
    ["dueDate", "expectedPayout", "id", "payout", "recipient", "roundNumber", "status"],
  );
  assert.deepEqual(Object.keys(result.rounds[0]!.recipient).sort(), ["displayName", "memberCode", "memberId", "payoutOrder"]);
  assert.deepEqual(Object.keys(result.rounds[0]!.expectedPayout).sort(), ["amount", "currency"]);
  assert.deepEqual(
    Object.keys(result.rounds[0]!.payout ?? {}).sort(),
    [
      "amount",
      "clientOperationId",
      "confirmedAt",
      "confirmedByMemberId",
      "currency",
      "disputeReason",
      "disputedAt",
      "disputedByMemberId",
      "id",
      "recordedAt",
      "recordedById",
      "status",
    ],
  );
  assert.deepEqual(Object.keys(result.summary).sort(), [
    "confirmedCount",
    "disputedCount",
    "recordedCount",
    "totalRounds",
    "unrecordedCount",
  ]);
});

test("the owner-read repository does not widen circle-member-dashboard.repository.ts's member-facing selects", () => {
  const memberRepoPath = fileURLToPath(new URL("../repositories/circle-member-dashboard.repository.ts", import.meta.url));
  const source = readFileSync(memberRepoPath, "utf8");
  assert.doesNotMatch(source, /memberCode/);
});

// -------------------------------------------------------------------
// Architecture
// -------------------------------------------------------------------

test("this read model performs no writes", async () => {
  const fixture = await createActiveCircleWithRound();
  const payoutCountBefore = await prisma.payout.count();
  const obligationCountBefore = await prisma.contributionObligation.count();

  await getOwnerCirclePayouts({ ownerId: fixture.ownerId, circleId: fixture.circleId });

  const payoutCountAfter = await prisma.payout.count();
  const obligationCountAfter = await prisma.contributionObligation.count();
  assert.equal(payoutCountAfter, payoutCountBefore);
  assert.equal(obligationCountAfter, obligationCountBefore);
});

test("getOwnerCirclePayouts has no member-session/auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./payout-owner-read.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
});

test("no mutation call sites exist anywhere in the service or repository", () => {
  const servicePath = fileURLToPath(new URL("./payout-owner-read.service.ts", import.meta.url));
  const repositoryPath = fileURLToPath(new URL("../repositories/payout-owner-read.repository.ts", import.meta.url));
  for (const path of [servicePath, repositoryPath]) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      ".create(",
      ".update(",
      ".updateMany(",
      ".delete(",
      ".deleteMany(",
      ".upsert(",
      "$transaction",
      "lockSavingsCircleForUpdate",
      "FOR UPDATE",
    ]) {
      assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}" in ${path}`);
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
