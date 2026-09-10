import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";
import { PayoutConfirmationDisputedError, confirmPayout } from "@/src/services/payout-confirmation.service";
import {
  InvalidDisputeReasonError,
  PayoutDisputeAccountingIntegrityError,
  PayoutDisputeCircleNotActiveError,
  PayoutDisputeConfirmedError,
  PayoutDisputeIntentConflictError,
  PayoutDisputeNotFoundError,
  PayoutDisputeProvenanceIntegrityError,
  PayoutDisputeReplayIntegrityError,
  PayoutDisputeUnauthorizedError,
  disputePayout,
} from "@/src/services/payout-dispute.service";
import { recordPayout } from "@/src/services/payout-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as
// payout-confirmation.service.test.ts: unique-id-scoped fixtures,
// FK-ordered cleanup in test.after regardless of outcome, before/after
// row counts on unrelated domain tables. No TEST_DATABASE_URL required.
// Fixtures use the real, already-shipped recordPayout (7K.3) to produce a
// genuinely RECORDED payout rather than hand-inserting one.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "PAYOUT_DISPUTE_TEST_OWNER", email: `${unique("payout-dispute-test-owner")}@example.invalid` },
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
      name: unique("PayoutDisputeTestCircle"),
      currency,
      contributionAmount,
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
      activatedAt: status === "ACTIVE" ? new Date("2026-01-01T00:00:00.000Z") : null,
      activatedById: status === "ACTIVE" ? ownerId : null,
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

async function createFixtureRound(
  circleId: string,
  input: { roundNumber: number; recipientId: string; dueDate: Date },
) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: input.dueDate,
      status: "UPCOMING",
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
 * A genuinely RECORDED payout: an ACTIVE circle, `memberAmounts.length`
 * members, one round (recipient = the first member), one obligation per
 * member for that round, and one RECORDED Payout produced by the real
 * recordPayout service (7K.3) -- never hand-inserted.
 */
async function createRecordedPayoutFixture(options?: {
  memberAmounts?: readonly string[];
  currency?: string;
}) {
  const memberAmounts = options?.memberAmounts ?? ["25.00"];
  const currency = options?.currency ?? "USD";
  const total = memberAmounts.reduce((sum, value) => sum + Number(value), 0).toFixed(2);

  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", memberAmounts[0], currency);

  const memberIds: string[] = [];
  for (const [index] of memberAmounts.entries()) {
    memberIds.push(await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1));
  }

  const dueDate = new Date("2026-01-08T00:00:00.000Z");
  const roundId = await createFixtureRound(circleId, { roundNumber: 1, recipientId: memberIds[0], dueDate });

  const obligationIds: string[] = [];
  for (const [index, expectedAmount] of memberAmounts.entries()) {
    obligationIds.push(
      await createFixtureObligation(circleId, roundId, memberIds[index], { expectedAmount, currency, dueDate }),
    );
  }

  const recipientId = memberIds[0];
  const recorded = await recordPayout({
    ownerId,
    circleId,
    input: { roundId, amount: total, clientOperationId: unique("op") },
  });

  return { ownerId, circleId, roundId, memberIds, obligationIds, recipientId, payoutId: recorded.id, total };
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
// Happy path
// -------------------------------------------------------------------

test("the persisted recipient disputes a RECORDED payout, which becomes DISPUTED", async () => {
  const fixture = await createRecordedPayoutFixture();
  const before = new Date();

  const result = await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Never received the funds." },
  });

  assert.equal(result.status, "DISPUTED");
  assert.equal(result.id, fixture.payoutId);
  assert.equal(result.circleId, fixture.circleId);
  assert.equal(result.roundId, fixture.roundId);
  assert.equal(result.disputedByMemberId, fixture.recipientId);
  assert.equal(result.disputeReason, "Never received the funds.");
  assert.ok(new Date(result.disputedAt).getTime() >= before.getTime() - 1000);

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "DISPUTED");
  assert.equal(persisted.disputedByMemberId, fixture.recipientId);
  assert.equal(persisted.disputeReason, "Never received the funds.");
  assert.ok(persisted.disputedAt);
});

test("recording provenance is unchanged by a dispute", async () => {
  const fixture = await createRecordedPayoutFixture();
  const before = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });

  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });

  const after = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(after.circleId, before.circleId);
  assert.equal(after.roundId, before.roundId);
  assert.ok(after.amount.equals(before.amount));
  assert.equal(after.currency, before.currency);
  assert.equal(after.clientOperationId, before.clientOperationId);
  assert.equal(after.recordedById, before.recordedById);
  assert.equal(after.recordedAt.toISOString(), before.recordedAt.toISOString());
});

test("the serialized result exposes only the whitelisted fields", async () => {
  const fixture = await createRecordedPayoutFixture();
  const result = await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });

  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "amount",
      "circleId",
      "currency",
      "disputeReason",
      "disputedAt",
      "disputedByMemberId",
      "id",
      "recordedAt",
      "recordedById",
      "roundId",
      "status",
    ].sort(),
  );
});

// -------------------------------------------------------------------
// Authorization
// -------------------------------------------------------------------

test("a non-recipient member of the same circle is rejected as unauthorized", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: otherMemberId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not mine to dispute." },
      }),
    PayoutDisputeUnauthorizedError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "RECORDED");
});

test("a member of a different circle entirely is rejected as not found, not unauthorized", async () => {
  const fixture = await createRecordedPayoutFixture();
  const foreignCircleId = await createFixtureCircle(fixture.ownerId, "ACTIVE", "10.00");
  const foreignMemberId = await createFixtureMember(foreignCircleId, fixture.ownerId, "FOREIGN", 1);

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: foreignMemberId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeNotFoundError,
  );
});

test("a nonexistent payout is rejected as not found", async () => {
  const fixture = await createRecordedPayoutFixture();

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: "no-such-payout", disputeReason: "Not received." },
      }),
    PayoutDisputeNotFoundError,
  );
});

test("a foreign payout (belonging to a different circle) collapses to the same not-found outcome", async () => {
  const fixtureA = await createRecordedPayoutFixture();
  const fixtureB = await createRecordedPayoutFixture();

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixtureB.circleId,
        memberId: fixtureB.recipientId,
        input: { payoutId: fixtureA.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeNotFoundError,
  );
});

test("disputePayout does not accept a member/recipient identifier in its input", () => {
  const servicePath = fileURLToPath(new URL("./payout-dispute.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8");
  assert.doesNotMatch(source, /input\.memberId/);
  assert.doesNotMatch(source, /input\.recipientId/);
});

test("disputePayout has no owner-auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./payout-dispute.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireUser/);
  assert.doesNotMatch(source, /ownerId/);
});

// -------------------------------------------------------------------
// Validation / reason
// -------------------------------------------------------------------

test("an empty dispute reason is rejected", async () => {
  const fixture = await createRecordedPayoutFixture();
  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "" },
      }),
    InvalidDisputeReasonError,
  );
});

test("a whitespace-only dispute reason is rejected", async () => {
  const fixture = await createRecordedPayoutFixture();
  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "    " },
      }),
    InvalidDisputeReasonError,
  );
});

test("an excessively long dispute reason is rejected", async () => {
  const fixture = await createRecordedPayoutFixture();
  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "x".repeat(501) },
      }),
    InvalidDisputeReasonError,
  );
});

test("a replay with the exact same reason succeeds without writing again", async () => {
  const fixture = await createRecordedPayoutFixture();
  const first = await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });
  const before = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });
  const after = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });

  assert.deepEqual(second, first);
  assert.equal(after.disputedAt?.getTime(), before.disputedAt?.getTime(), "replay must not regenerate disputedAt");
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "a replay must not write the row at all");
});

test("a replay with a different reason is an intent conflict, and the original reason is never overwritten", async () => {
  const fixture = await createRecordedPayoutFixture();
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Different reason entirely." },
      }),
    PayoutDisputeIntentConflictError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.disputeReason, "Not received.", "the original reason must never be overwritten");
});

// -------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------

test("a fresh dispute succeeds while the circle is ACTIVE", async () => {
  const fixture = await createRecordedPayoutFixture();
  const result = await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });
  assert.equal(result.status, "DISPUTED");
});

test("a fresh dispute on a non-ACTIVE circle is rejected", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeCircleNotActiveError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "RECORDED");
});

for (const status of ["COMPLETED", "ARCHIVED"] as const) {
  test(`a DISPUTED replay succeeds after the circle becomes ${status}`, async () => {
    const fixture = await createRecordedPayoutFixture();
    const first = await disputePayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
    });

    await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status } });

    const replay = await disputePayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
    });
    assert.deepEqual(replay, first);
  });
}

// -------------------------------------------------------------------
// State transitions
// -------------------------------------------------------------------

test("a CONFIRMED payout cannot be disputed -- terminal conflict, never overwritten", async () => {
  const fixture = await createRecordedPayoutFixture();
  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Changed my mind." },
      }),
    PayoutDisputeConfirmedError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "CONFIRMED");
  assert.equal(persisted.disputedAt, null);
  assert.equal(persisted.disputedByMemberId, null);
  assert.equal(persisted.disputeReason, null);
});

test("a CONFIRMED payout stays CONFIRMED even after the circle becomes COMPLETED", async () => {
  const fixture = await createRecordedPayoutFixture();
  await confirmPayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId },
  });
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Changed my mind." },
      }),
    PayoutDisputeConfirmedError,
  );
});

test("dispute never writes confirmation provenance", async () => {
  const fixture = await createRecordedPayoutFixture();
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.confirmedAt, null);
  assert.equal(persisted.confirmedByMemberId, null);
});

// -------------------------------------------------------------------
// Integrity
// -------------------------------------------------------------------

test("a persisted amount mismatch against frozen obligation history is an accounting integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.payout.update({ where: { id: fixture.payoutId }, data: { amount: "26.00" } });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeAccountingIntegrityError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "RECORDED");
});

test("a persisted currency mismatch against the authoritative round currency is an accounting integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.payout.update({ where: { id: fixture.payoutId }, data: { currency: "EUR" } });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeAccountingIntegrityError,
  );
});

test("obligations disagreeing on currency after recording surface the domain's own accounting integrity error", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  await prisma.contributionObligation.update({ where: { id: fixture.obligationIds[1] }, data: { currency: "EUR" } });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutAccountingIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray confirmation provenance is a provenance integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedByMemberId" = ${fixture.recipientId} WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeProvenanceIntegrityError,
  );
});

test("a RECORDED payout manufactured with stray dispute provenance is a provenance integrity conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedAt" = now(), "disputedByMemberId" = ${fixture.recipientId}, "disputeReason" = 'stray' WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeProvenanceIntegrityError,
  );
});

test("a DISPUTED payout with contradictory confirmation provenance fails replay as a corrupted-history conflict", async () => {
  const fixture = await createRecordedPayoutFixture();
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });
  await prisma.$executeRaw`UPDATE "Payout" SET "confirmedAt" = now(), "confirmedByMemberId" = ${fixture.recipientId} WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeReplayIntegrityError,
  );
});

test("a DISPUTED payout whose disputedByMemberId does not match the persisted recipient fails replay", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  const otherMemberId = fixture.memberIds[1];
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });
  // Manufactured corruption: the persisted recipient never changes, but the
  // dispute actor recorded on the row is overwritten to someone else.
  await prisma.$executeRaw`UPDATE "Payout" SET "disputedByMemberId" = ${otherMemberId} WHERE "id" = ${fixture.payoutId}`;

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeReplayIntegrityError,
  );
});

test("a DISPUTED payout whose amount no longer matches the frozen obligation sum fails replay, never auto-repaired", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });
  await prisma.contributionObligation.update({
    where: { id: fixture.obligationIds[1] },
    data: { expectedAmount: "30.00" },
  });

  await assert.rejects(
    () =>
      disputePayout({
        circleId: fixture.circleId,
        memberId: fixture.recipientId,
        input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
      }),
    PayoutDisputeReplayIntegrityError,
  );

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "DISPUTED", "never repaired -- the corrupted row is left exactly as found");
});

// -------------------------------------------------------------------
// Concurrency (real Postgres)
// -------------------------------------------------------------------

test("two concurrent disputes with the SAME reason resolve safely to exactly one fresh transition", async () => {
  const fixture = await createRecordedPayoutFixture();

  const results = await Promise.allSettled([
    disputePayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
    }),
    disputePayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
    }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent disputes with the same reason must resolve safely");
  }
  const values = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  assert.deepEqual(values[0], values[1], "both calls must resolve to the identical DISPUTED state");

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "DISPUTED");
});

test("two concurrent disputes with DIFFERENT reasons leave exactly one winning reason, never overwritten", async () => {
  const fixture = await createRecordedPayoutFixture();

  const results = await Promise.allSettled([
    disputePayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId, disputeReason: "Reason A." },
    }),
    disputePayout({
      circleId: fixture.circleId,
      memberId: fixture.recipientId,
      input: { payoutId: fixture.payoutId, disputeReason: "Reason B." },
    }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one competing reason must win");
  assert.equal(rejected.length, 1, "exactly one competing reason must lose");
  if (rejected[0]?.status === "rejected") {
    assert.ok(
      rejected[0].reason instanceof PayoutDisputeIntentConflictError,
      `the loser must receive an intent conflict, got ${String(rejected[0].reason)}`,
    );
  }

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
  assert.equal(persisted.status, "DISPUTED");
  assert.ok(
    persisted.disputeReason === "Reason A." || persisted.disputeReason === "Reason B.",
    "the persisted reason must be exactly one of the two competing reasons, never a mix or overwrite",
  );
  if (fulfilled[0]?.status === "fulfilled") {
    assert.equal(persisted.disputeReason, fulfilled[0].value.disputeReason);
  }
});

// -------------------------------------------------------------------
// Real confirm-vs-dispute race
// -------------------------------------------------------------------

test("a real confirm-vs-dispute race on the same RECORDED payout resolves to exactly one terminal outcome", async (t) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await t.test(`attempt ${attempt + 1}`, async () => {
      const fixture = await createRecordedPayoutFixture();

      const results = await Promise.allSettled([
        confirmPayout({
          circleId: fixture.circleId,
          memberId: fixture.recipientId,
          input: { payoutId: fixture.payoutId },
        }),
        disputePayout({
          circleId: fixture.circleId,
          memberId: fixture.recipientId,
          input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
        }),
      ]);
      const [confirmResult, disputeResult] = results;

      const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: fixture.payoutId } });
      assert.ok(
        persisted.status === "CONFIRMED" || persisted.status === "DISPUTED",
        `expected a single terminal outcome, got ${persisted.status}`,
      );

      if (persisted.status === "CONFIRMED") {
        // A. CONFIRMED wins.
        assert.equal(confirmResult.status, "fulfilled", "the confirm caller must observe its own success");
        assert.ok(persisted.confirmedAt, "confirmedAt must be populated");
        assert.equal(persisted.confirmedByMemberId, fixture.recipientId);
        assert.equal(persisted.disputedAt, null, "no dispute provenance may exist alongside a CONFIRMED payout");
        assert.equal(persisted.disputedByMemberId, null);
        assert.equal(persisted.disputeReason, null);

        assert.equal(disputeResult.status, "rejected", "the dispute caller must observe the terminal conflict");
        if (disputeResult.status === "rejected") {
          assert.ok(
            disputeResult.reason instanceof PayoutDisputeConfirmedError,
            `expected PayoutDisputeConfirmedError, got ${String(disputeResult.reason)}`,
          );
        }
      } else {
        // B. DISPUTED wins.
        assert.equal(disputeResult.status, "fulfilled", "the dispute caller must observe its own success");
        assert.ok(persisted.disputedAt, "disputedAt must be populated");
        assert.equal(persisted.disputedByMemberId, fixture.recipientId);
        assert.ok(persisted.disputeReason);
        assert.equal(persisted.confirmedAt, null, "no confirmation provenance may exist alongside a DISPUTED payout");
        assert.equal(persisted.confirmedByMemberId, null);

        assert.equal(confirmResult.status, "rejected", "the confirm caller must observe the terminal conflict");
        if (confirmResult.status === "rejected") {
          assert.ok(
            confirmResult.reason instanceof PayoutConfirmationDisputedError,
            `expected PayoutConfirmationDisputedError, got ${String(confirmResult.reason)}`,
          );
        }
      }
    });
  }
});

// -------------------------------------------------------------------
// Architecture
// -------------------------------------------------------------------

test("disputePayout mutates nothing but the Payout row's status/disputedAt/disputedByMemberId/disputeReason", async () => {
  const fixture = await createRecordedPayoutFixture({ memberAmounts: ["25.00", "25.00"] });
  const roundBefore = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  const obligationsBefore = await prisma.contributionObligation.findMany({
    where: { roundId: fixture.roundId },
    orderBy: { id: "asc" },
  });
  const circleBefore = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });

  await disputePayout({
    circleId: fixture.circleId,
    memberId: fixture.recipientId,
    input: { payoutId: fixture.payoutId, disputeReason: "Not received." },
  });

  const roundAfter = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  assert.deepEqual(roundAfter, roundBefore, "PayoutRound must be untouched");

  const obligationsAfter = await prisma.contributionObligation.findMany({
    where: { roundId: fixture.roundId },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(obligationsAfter, obligationsBefore, "ContributionObligation rows must be untouched");

  const circleAfter = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.deepEqual(circleAfter, circleBefore, "SavingsCircle lifecycle must be untouched");

  assert.equal(
    await prisma.contributionPayment.count({ where: { circleId: fixture.circleId } }),
    0,
    "no ContributionPayment may be created or changed",
  );
});

test("disputePayout reads no round status, due date, or live-cohort signal", () => {
  const servicePath = fileURLToPath(new URL("./payout-dispute.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /dueDate/);
  assert.doesNotMatch(source, /payoutOrder/);
  assert.doesNotMatch(source, /round\.status/);
  assert.doesNotMatch(source, /roundStatus/);
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
