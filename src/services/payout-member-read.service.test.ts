import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";
import { confirmPayout } from "@/src/services/payout-confirmation.service";
import { disputePayout } from "@/src/services/payout-dispute.service";
import {
  MemberPayoutsCircleNotEligibleError,
  MemberPayoutsCircleNotFoundError,
  MemberPayoutsIntegrityError,
  MemberPayoutsMemberNotActiveError,
  MemberPayoutsMemberNotFoundError,
  getCircleMemberPayouts,
} from "@/src/services/payout-member-read.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as
// payout-owner-read.service.test.ts / payout-dispute.service.test.ts:
// unique-id-scoped fixtures, FK-ordered cleanup in test.after regardless
// of outcome, before/after row counts on unrelated domain tables. No
// TEST_DATABASE_URL required. Fixtures use the real, already-shipped
// recordPayout/confirmPayout/disputePayout (7K.3/7K.4/7K.5) to produce
// genuine RECORDED/CONFIRMED/DISPUTED payouts rather than hand-inserting
// them.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "PAYOUT_MEMBER_READ_TEST_OWNER", email: `${unique("payout-member-read-test-owner")}@example.invalid` },
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
      name: unique("PayoutMemberReadTestCircle"),
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
    select: { id: true },
  });
  return member.id;
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
 * obligation per member for that round -- mirrors
 * payout-owner-read.service.test.ts's own identical helper.
 */
async function createActiveCircleWithRound(options?: {
  memberAmounts?: readonly string[];
  currencies?: readonly string[];
  currency?: string;
  dueDate?: Date;
}) {
  const memberAmounts = options?.memberAmounts ?? ["25.00"];
  const currency = options?.currency ?? "USD";
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", memberAmounts[0], currency);

  const memberIds: string[] = [];
  for (const [index] of memberAmounts.entries()) {
    memberIds.push(await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1));
  }

  const dueDate = options?.dueDate ?? new Date("2026-01-08T00:00:00.000Z");
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberIds[0], dueDate });

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

test("a member can read their own eligible (ACTIVE) circle's payout history", async () => {
  const fixture = await createActiveCircleWithRound();
  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });

  assert.equal(result.circle.id, fixture.circleId);
  assert.equal(result.circle.status, "ACTIVE");
  assert.equal(result.recipientRounds.length, 1);
  assert.equal(result.recipientRounds[0]?.id, fixture.roundId);
});

test("a member not belonging to the circle is rejected as not found", async () => {
  const fixture = await createActiveCircleWithRound();
  const otherCircleOwnerId = await createOwner();
  const foreignCircleId = await createFixtureCircle(otherCircleOwnerId, "ACTIVE", "10.00");
  const foreignMemberId = await createFixtureMember(foreignCircleId, otherCircleOwnerId, "FOREIGN", 1);

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: foreignMemberId }),
    MemberPayoutsMemberNotFoundError,
  );
});

test("a foreign-circle member id is rejected as not found (never confused with a same-circle member)", async () => {
  const fixture = await createActiveCircleWithRound();
  const foreignCircleId = await createFixtureCircle(fixture.ownerId, "ACTIVE", "10.00");
  const foreignMemberId = await createFixtureMember(foreignCircleId, fixture.ownerId, "FOREIGN", 1);

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: foreignMemberId }),
    MemberPayoutsMemberNotFoundError,
  );
});

test("a nonexistent circle is rejected with MemberPayoutsCircleNotFoundError", async () => {
  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: "not-a-real-circle-id", memberId: "not-a-real-member-id" }),
    MemberPayoutsCircleNotFoundError,
  );
});

test("a DRAFT circle is rejected with MemberPayoutsCircleNotEligibleError", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", "10.00");
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId, memberId }),
    MemberPayoutsCircleNotEligibleError,
  );
});

test("a REMOVED member is rejected with MemberPayoutsMemberNotActiveError", async () => {
  const fixture = await createActiveCircleWithRound();
  await prisma.circleMember.update({ where: { id: fixture.recipientId }, data: { status: "REMOVED" } });

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsMemberNotActiveError,
  );
});

test("a COMPLETED circle's payout history remains readable for the member", async () => {
  const fixture = await createActiveCircleWithRound();
  await recordFixturePayout(fixture);
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.circle.status, "COMPLETED");
  assert.equal(result.recipientRounds[0]?.payout?.status, "RECORDED");
});

test("an ARCHIVED circle's payout history remains readable for the member", async () => {
  const fixture = await createActiveCircleWithRound();
  await recordFixturePayout(fixture);
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "ARCHIVED" } });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.circle.status, "ARCHIVED");
  assert.equal(result.recipientRounds[0]?.payout?.status, "RECORDED");
});

// -------------------------------------------------------------------
// Recipient authority
// -------------------------------------------------------------------

test("only the round where recipientId === memberId is returned; a non-recipient member sees none", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const nonRecipientMemberId = fixture.memberIds[1];

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: nonRecipientMemberId });
  assert.deepEqual(result.recipientRounds, []);
});

test("the recipient's own round fields are returned verbatim, and current payoutOrder mutation does not alter recipient visibility", async () => {
  const fixture = await createActiveCircleWithRound({ dueDate: new Date("2026-03-15T00:00:00.000Z") });
  await prisma.payoutRound.update({ where: { id: fixture.roundId }, data: { status: "CLOSED" } });
  await prisma.circleMember.update({ where: { id: fixture.recipientId }, data: { payoutOrder: 99 } });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  const round = result.recipientRounds[0]!;
  assert.equal(round.roundNumber, 1);
  assert.equal(round.dueDate, new Date("2026-03-15T00:00:00.000Z").toISOString());
  assert.equal(round.status, "CLOSED");
  assert.equal(result.recipientRounds.length, 1, "recipient visibility must not change when payoutOrder does");
});

// -------------------------------------------------------------------
// Expected payout
// -------------------------------------------------------------------

test("expected payout for a single obligation equals that obligation's expected amount", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00"] });
  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.expectedPayout.amount, "25.00");
});

test("expected payout for multiple obligations is their exact Decimal sum", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["33.33", "33.33", "33.33"] });
  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.expectedPayout.amount, "99.99");
});

test("expected payout currency follows the obligations, e.g. XOF", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["5000.00", "5000.00"], currency: "XOF" });
  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.expectedPayout.currency, "XOF");
  assert.equal(result.recipientRounds[0]?.expectedPayout.amount, "10000.00");
});

test("obligations disagreeing on currency for the recipient round are rejected as an accounting integrity failure", async () => {
  const fixture = await createActiveCircleWithRound({
    memberAmounts: ["25.00", "25.00"],
    currencies: ["USD", "EUR"],
  });

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    PayoutAccountingIntegrityError,
  );
});

test("a recipient round with no obligation history is rejected, never displayed as a zero-amount payout", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "25.00");
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberId });

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId, memberId }),
    PayoutAccountingIntegrityError,
  );
});

test("expected payout is never derived from the live member cohort", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  await createFixtureMember(fixture.circleId, fixture.ownerId, "LATE", 3);

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.expectedPayout.amount, "50.00");
});

test("expected payout is never derived from the circle's current (mutable) contributionAmount", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { contributionAmount: "40.00" } });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.expectedPayout.amount, "50.00");
});

// -------------------------------------------------------------------
// Payout visibility
// -------------------------------------------------------------------

test("no payout row yields payout: null", async () => {
  const fixture = await createActiveCircleWithRound();
  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.payout, null);
});

test("a RECORDED payout is visible to the recipient", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  const payout = result.recipientRounds[0]?.payout;
  assert.equal(payout?.id, recorded.id);
  assert.equal(payout?.status, "RECORDED");
});

test("a CONFIRMED payout is visible to the recipient", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  assert.equal(result.recipientRounds[0]?.payout?.status, "CONFIRMED");
  assert.ok(result.recipientRounds[0]?.payout?.confirmedAt);
});

test("a DISPUTED payout is visible to the recipient, never hidden, with the exact persisted reason", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: recorded.id, disputeReason: "Never received the funds." },
  });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  const payout = result.recipientRounds[0]?.payout;
  assert.equal(payout?.status, "DISPUTED");
  assert.equal(payout?.disputeReason, "Never received the funds.");
  assert.ok(payout?.disputedAt);
});

// -------------------------------------------------------------------
// Integrity
// -------------------------------------------------------------------

test("a persisted amount drift against frozen obligation history is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.payout.update({ where: { id: recorded.id }, data: { amount: "999.00" } });

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
  );
});

test("a persisted currency drift against the authoritative obligation currency is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.payout.update({ where: { id: recorded.id }, data: { currency: "EUR" } });

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray confirmation provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedAt" = now(), "confirmedByMemberId" = ${fixture.recipientId} WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
  );
});

test("a CONFIRMED payout missing confirmation provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedAt" = NULL WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
  );
});

test("a CONFIRMED payout whose confirmedByMemberId does not match the persisted recipient is rejected", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedByMemberId" = ${otherMemberId} WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
  );
});

test("a CONFIRMED payout carrying dispute provenance is rejected", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await confirmPayout({ circleId: fixture.circleId, memberId: fixture.recipientId, input: { payoutId: recorded.id } });
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${fixture.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${recorded.id}`;

  await assert.rejects(
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
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
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
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
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
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
    () => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }),
    MemberPayoutsIntegrityError,
  );
});

test("integrity failures are never auto-repaired -- the corrupted row is left exactly as found", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await prisma.payout.update({ where: { id: recorded.id }, data: { currency: "EUR" } });

  await assert.rejects(() => getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId }));

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });
  assert.equal(persisted.currency, "EUR");
});

// -------------------------------------------------------------------
// Cross-member privacy (7K.8 ticket section 15) -- a real data-boundary
// test, not source regex alone.
// -------------------------------------------------------------------

test("Member A cannot see Member B's recipient round, payout, status, or dispute reason -- Member B legitimately sees their own", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberA = await createFixtureMember(circleId, ownerId, "Member A", 1);
  const memberB = await createFixtureMember(circleId, ownerId, "Member B", 2);

  const roundA = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberA, status: "ACTIVE" });
  const roundB = await createFixtureRound(circleId, { roundNumber: 2, recipientId: memberB, status: "ACTIVE" });
  // Distinct per-round totals (A: 10.00, B: 30.00) so a leaked amount is
  // unambiguous rather than a coincidental match against A's own legitimate
  // expected payout.
  await createFixtureObligation(circleId, roundA, memberA, { expectedAmount: "5.00" });
  await createFixtureObligation(circleId, roundA, memberB, { expectedAmount: "5.00" });
  await createFixtureObligation(circleId, roundB, memberA, { expectedAmount: "15.00" });
  await createFixtureObligation(circleId, roundB, memberB, { expectedAmount: "15.00" });

  // B's payout, DISPUTED with a distinctive, uniquely identifiable reason.
  const payoutB = await recordPayout({
    ownerId,
    circleId,
    input: { roundId: roundB, amount: "30.00", clientOperationId: unique("op-b") },
  });
  const distinctiveReason = `UNIQUELY-IDENTIFIABLE-REASON-${unique("secret")}`;
  await disputePayout({
    circleId,
    memberId: memberB,
    input: { payoutId: payoutB.id, disputeReason: distinctiveReason },
  });

  const resultForA = await getCircleMemberPayouts({ circleId, memberId: memberA });
  const serializedA = JSON.stringify(resultForA);

  assert.equal(resultForA.recipientRounds.length, 1, "A must see only A's own recipient round");
  assert.equal(resultForA.recipientRounds[0]?.id, roundA);
  assert.doesNotMatch(serializedA, new RegExp(roundB));
  assert.doesNotMatch(serializedA, new RegExp(payoutB.id));
  assert.doesNotMatch(serializedA, /DISPUTED/, "A's result must contain no trace of B's DISPUTED status");
  assert.doesNotMatch(serializedA, new RegExp(distinctiveReason));
  assert.doesNotMatch(serializedA, /30\.00/, "B's uniquely-sized payout amount must not appear in A's result");
  assert.equal(resultForA.recipientRounds[0]?.expectedPayout.amount, "10.00", "A's own expected payout must be A's own round total, not B's");

  // B, calling for themselves, legitimately sees their own round/payout.
  const resultForB = await getCircleMemberPayouts({ circleId, memberId: memberB });
  assert.equal(resultForB.recipientRounds.length, 1);
  assert.equal(resultForB.recipientRounds[0]?.id, roundB);
  assert.equal(resultForB.recipientRounds[0]?.payout?.id, payoutB.id);
  assert.equal(resultForB.recipientRounds[0]?.payout?.status, "DISPUTED");
  assert.equal(resultForB.recipientRounds[0]?.payout?.disputeReason, distinctiveReason);
});

test("Member A cannot see Member B's RECORDED-only payout either (not just the terminal states)", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberA = await createFixtureMember(circleId, ownerId, "Member A", 1);
  const memberB = await createFixtureMember(circleId, ownerId, "Member B", 2);
  const roundA = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberA });
  const roundB = await createFixtureRound(circleId, { roundNumber: 2, recipientId: memberB });
  await createFixtureObligation(circleId, roundA, memberA, { expectedAmount: "10.00" });
  await createFixtureObligation(circleId, roundA, memberB, { expectedAmount: "10.00" });
  await createFixtureObligation(circleId, roundB, memberA, { expectedAmount: "10.00" });
  await createFixtureObligation(circleId, roundB, memberB, { expectedAmount: "10.00" });

  const payoutB = await recordPayout({
    ownerId,
    circleId,
    input: { roundId: roundB, amount: "20.00", clientOperationId: unique("op-b") },
  });

  const resultForA = await getCircleMemberPayouts({ circleId, memberId: memberA });
  assert.equal(resultForA.recipientRounds.length, 1);
  const serializedA = JSON.stringify(resultForA);
  assert.doesNotMatch(serializedA, new RegExp(payoutB.id));
  assert.doesNotMatch(serializedA, /RECORDED/, "A's result must contain no trace of B's RECORDED status");
});

test("Member A cannot see Member B's CONFIRMED payout either", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberA = await createFixtureMember(circleId, ownerId, "Member A", 1);
  const memberB = await createFixtureMember(circleId, ownerId, "Member B", 2);
  const roundA = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberA });
  const roundB = await createFixtureRound(circleId, { roundNumber: 2, recipientId: memberB });
  await createFixtureObligation(circleId, roundA, memberA, { expectedAmount: "10.00" });
  await createFixtureObligation(circleId, roundA, memberB, { expectedAmount: "10.00" });
  await createFixtureObligation(circleId, roundB, memberA, { expectedAmount: "10.00" });
  await createFixtureObligation(circleId, roundB, memberB, { expectedAmount: "10.00" });

  const payoutB = await recordPayout({
    ownerId,
    circleId,
    input: { roundId: roundB, amount: "20.00", clientOperationId: unique("op-b") },
  });
  await confirmPayout({ circleId, memberId: memberB, input: { payoutId: payoutB.id } });

  const resultForA = await getCircleMemberPayouts({ circleId, memberId: memberA });
  assert.equal(resultForA.recipientRounds.length, 1);
  const serializedA = JSON.stringify(resultForA);
  assert.doesNotMatch(serializedA, new RegExp(payoutB.id));
  assert.doesNotMatch(serializedA, /CONFIRMED/);
});

// -------------------------------------------------------------------
// Privacy: field-level exclusions
// -------------------------------------------------------------------

test("no actor id (recordedById/confirmedByMemberId/disputedByMemberId) or clientOperationId is ever exposed", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: recorded.id, disputeReason: "Not received." },
  });

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /recordedById/);
  assert.doesNotMatch(serialized, /confirmedByMemberId/);
  assert.doesNotMatch(serialized, /disputedByMemberId/);
  assert.doesNotMatch(serialized, /clientOperationId/);
  // The actor id VALUES themselves (the owner's user id, the recipient's
  // own member id) must not appear either -- not just the key names.
  assert.doesNotMatch(serialized, new RegExp(fixture.ownerId));
});

test("no PIN hash, auth counters, session, memberCode, or raw User field is ever exposed", async () => {
  const fixture = await createActiveCircleWithRound();
  await recordFixturePayout(fixture);

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /pinHash/i);
  assert.doesNotMatch(serialized, /failedPinAttempts/i);
  assert.doesNotMatch(serialized, /lockedUntil/i);
  assert.doesNotMatch(serialized, /credentialVersion/i);
  assert.doesNotMatch(serialized, /session/i);
  assert.doesNotMatch(serialized, /memberCode/i);
});

test("the result exposes only the whitelisted fields at every level", async () => {
  const fixture = await createActiveCircleWithRound();
  const recorded = await recordFixturePayout(fixture);
  void recorded;

  const result = await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });

  assert.deepEqual(Object.keys(result).sort(), ["circle", "recipientRounds"]);
  assert.deepEqual(Object.keys(result.circle).sort(), ["currency", "id", "name", "status"]);
  assert.deepEqual(
    Object.keys(result.recipientRounds[0]!).sort(),
    ["dueDate", "expectedPayout", "id", "payout", "roundNumber", "status"],
  );
  assert.deepEqual(Object.keys(result.recipientRounds[0]!.expectedPayout).sort(), ["amount", "currency"]);
  assert.deepEqual(
    Object.keys(result.recipientRounds[0]!.payout ?? {}).sort(),
    ["amount", "confirmedAt", "currency", "disputeReason", "disputedAt", "id", "recordedAt", "status"],
  );
});

// -------------------------------------------------------------------
// Architecture
// -------------------------------------------------------------------

test("the repository's recipient-round query filters by recipientId at the database layer", () => {
  const repoPath = fileURLToPath(new URL("../repositories/payout-member-read.repository.ts", import.meta.url));
  const source = readFileSync(repoPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(
    source,
    /findMany\(\{\s*where:\s*\{\s*circleId,\s*recipientId:\s*memberId\s*\}/,
    "expected the round query's own WHERE clause to filter by recipientId, not just circleId",
  );
});

test("this read model performs no writes", async () => {
  const fixture = await createActiveCircleWithRound();
  const payoutCountBefore = await prisma.payout.count();

  await getCircleMemberPayouts({ circleId: fixture.circleId, memberId: fixture.recipientId });

  const payoutCountAfter = await prisma.payout.count();
  assert.equal(payoutCountAfter, payoutCountBefore);
});

test("getCircleMemberPayouts has no requireCircleMember/session-cookie dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./payout-member-read.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
});

test("this ticket does not modify circle-member-dashboard.service.ts or its own repository", () => {
  // Structural proof, not just an assertion in prose: the dashboard files
  // are untouched by this ticket, so their own existing tests (7H.2) are
  // the sole source of truth for their behavior -- nothing here
  // duplicates or overrides it.
  const dashboardServicePath = fileURLToPath(new URL("./circle-member-dashboard.service.ts", import.meta.url));
  const source = readFileSync(dashboardServicePath, "utf8");
  assert.doesNotMatch(source, /getCircleMemberPayouts/);
  assert.doesNotMatch(source, /payout-member-read/);
});

test("no mutation call sites exist anywhere in the service or repository", () => {
  const servicePath = fileURLToPath(new URL("./payout-member-read.service.ts", import.meta.url));
  const repositoryPath = fileURLToPath(new URL("../repositories/payout-member-read.repository.ts", import.meta.url));
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
