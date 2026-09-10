import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PayoutAccountingIntegrityError } from "@/src/domain/payout-accounting";
import {
  InvalidPayoutAmountError,
  PayoutAlreadyRecordedError,
  PayoutAmountMismatchError,
  PayoutRecordingAuthorizationError,
  PayoutRecordingCircleNotActiveError,
  PayoutRecordingCircleNotFoundError,
  PayoutRecordingIntegrityConflictError,
  PayoutRecordingOperationConflictError,
  PayoutRecordingRoundNotFoundError,
  recordPayout,
} from "@/src/services/payout-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU ticket
// (contribution-recording.service.test.ts most directly): unique-id-scoped
// fixtures, FK-ordered cleanup in test.after regardless of outcome,
// before/after row counts on unrelated domain tables. No TEST_DATABASE_URL
// required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "PAYOUT_TEST_OWNER", email: `${unique("payout-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";
type RoundStatus = "UPCOMING" | "ACTIVE" | "CLOSED";

async function createFixtureCircle(
  ownerId: string,
  status: CircleStatus,
  contributionAmount: string,
  currency = "USD",
) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("PayoutTestCircle"),
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
  input: { roundNumber: number; recipientId: string; dueDate: Date; status: RoundStatus },
) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: input.dueDate,
      status: input.status,
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
 * frozen sum IS the round's authoritative payout amount.
 */
async function createActiveCircleWithRound(options?: {
  memberAmounts?: readonly string[];
  currencies?: readonly string[];
  currency?: string;
  contributionAmount?: string;
  roundStatus?: RoundStatus;
  dueDate?: Date;
}) {
  const memberAmounts = options?.memberAmounts ?? ["25.00"];
  const currency = options?.currency ?? "USD";
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(
    ownerId,
    "ACTIVE",
    options?.contributionAmount ?? memberAmounts[0],
    currency,
  );

  const memberIds: string[] = [];
  for (const [index] of memberAmounts.entries()) {
    memberIds.push(await createFixtureMember(circleId, ownerId, `M${index + 1}`, index + 1));
  }

  const dueDate = options?.dueDate ?? new Date("2026-01-08T00:00:00.000Z");
  const roundId = await createFixtureRound(circleId, {
    roundNumber: 1,
    recipientId: memberIds[0],
    dueDate,
    status: options?.roundStatus ?? "UPCOMING",
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

  return { ownerId, circleId, roundId, memberIds, obligationIds, recipientId: memberIds[0] };
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

test("an exact-amount recording succeeds and creates exactly one RECORDED payout", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00", "25.00"] });
  const before = new Date();

  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "75.00", clientOperationId: unique("op") },
  });

  assert.equal(result.status, "RECORDED");
  assert.equal(result.amount, "75.00");
  assert.equal(result.roundId, fixture.roundId);
  assert.equal(result.circleId, fixture.circleId);
  // Server-derived actor and timestamp -- never supplied by the caller.
  assert.equal(result.recordedById, fixture.ownerId);
  assert.ok(new Date(result.recordedAt).getTime() >= before.getTime() - 1000);

  const rows = await prisma.payout.findMany({ where: { roundId: fixture.roundId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "RECORDED");
  assert.equal(rows[0].recordedById, fixture.ownerId);
});

test("the persisted currency is derived from the round's obligations, never from client input", async () => {
  // The recording input carries no currency field at all; the only way a
  // payout can end up XOF is by the service reading it off the frozen
  // obligation history.
  const fixture = await createActiveCircleWithRound({
    memberAmounts: ["5000.00", "5000.00", "5000.00"],
    currency: "XOF",
  });

  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "15000.00", clientOperationId: unique("op") },
  });

  assert.equal(result.currency, "XOF");
  assert.equal(result.amount, "15000.00");
  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(persisted.currency, "XOF");
});

test("the serialized result exposes only the whitelisted fields -- no raw Prisma model, no recipient or auth data", async () => {
  const fixture = await createActiveCircleWithRound();
  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") },
  });

  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "amount",
      "circleId",
      "clientOperationId",
      "currency",
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

test("recording as a non-owner is rejected with PayoutRecordingAuthorizationError", async () => {
  const fixture = await createActiveCircleWithRound();
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: otherOwnerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") },
      }),
    PayoutRecordingAuthorizationError,
  );
  assert.equal(await prisma.payout.count({ where: { roundId: fixture.roundId } }), 0);
});

test("a nonexistent circle is rejected as not found", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () =>
      recordPayout({
        ownerId,
        circleId: "does-not-exist",
        input: { roundId: "does-not-exist", amount: "25.00", clientOperationId: unique("op") },
      }),
    PayoutRecordingCircleNotFoundError,
  );
});

test("a foreign round (belonging to a different circle) is rejected as round not found", async () => {
  const fixtureA = await createActiveCircleWithRound();
  const fixtureB = await createActiveCircleWithRound();

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixtureB.ownerId,
        circleId: fixtureB.circleId,
        input: { roundId: fixtureA.roundId, amount: "25.00", clientOperationId: unique("op") },
      }),
    PayoutRecordingRoundNotFoundError,
  );
  // The foreign circle's own round is untouched -- no payout leaked across.
  assert.equal(await prisma.payout.count({ where: { roundId: fixtureA.roundId } }), 0);
});

test("a nonexistent round collapses to the same outcome as a foreign round", async () => {
  const fixture = await createActiveCircleWithRound();
  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: "no-such-round-id", amount: "25.00", clientOperationId: unique("op") },
      }),
    PayoutRecordingRoundNotFoundError,
  );
});

test("a non-ACTIVE circle rejects a fresh recording attempt", async () => {
  const fixture = await createActiveCircleWithRound();
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") },
      }),
    PayoutRecordingCircleNotActiveError,
  );
  assert.equal(await prisma.payout.count({ where: { roundId: fixture.roundId } }), 0);
});

// -------------------------------------------------------------------
// Amount authority
// -------------------------------------------------------------------

test("the exact sum of multiple obligations is accepted", async () => {
  const fixture = await createActiveCircleWithRound({
    memberAmounts: ["25.00", "25.00", "25.00", "25.00"],
  });
  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "100.00", clientOperationId: unique("op") },
  });
  assert.equal(result.amount, "100.00");
});

test("a decimal-currency sum is exact -- 33.33 x 3 = 99.99, never 100.00", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["33.33", "33.33", "33.33"] });

  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "99.99", clientOperationId: unique("op") },
  });
  assert.equal(result.amount, "99.99");
});

test("underpayment is rejected", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00", "25.00"] });
  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") },
      }),
    PayoutAmountMismatchError,
  );
  assert.equal(await prisma.payout.count({ where: { roundId: fixture.roundId } }), 0);
});

test("overpayment is rejected", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00", "25.00"] });
  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "75.01", clientOperationId: unique("op") },
      }),
    PayoutAmountMismatchError,
  );
});

test("over-precise, zero, and negative amounts are rejected by the service's own defensive parse", async () => {
  const fixture = await createActiveCircleWithRound();
  for (const amount of ["25.999", "0.00", "-25.00"]) {
    await assert.rejects(
      () =>
        recordPayout({
          ownerId: fixture.ownerId,
          circleId: fixture.circleId,
          input: { roundId: fixture.roundId, amount, clientOperationId: unique("op") },
        }),
      InvalidPayoutAmountError,
      `expected amount "${amount}" to be rejected`,
    );
  }
});

test("obligations disagreeing on currency are rejected as an accounting integrity failure", async () => {
  const fixture = await createActiveCircleWithRound({
    memberAmounts: ["25.00", "25.00"],
    currencies: ["USD", "EUR"],
  });

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") },
      }),
    PayoutAccountingIntegrityError,
  );
  assert.equal(await prisma.payout.count({ where: { roundId: fixture.roundId } }), 0);
});

test("a round with no obligation history is rejected, never treated as a zero-amount payout", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "25.00");
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, {
    roundNumber: 1,
    recipientId: memberId,
    dueDate: new Date("2026-01-08T00:00:00.000Z"),
    status: "UPCOMING",
  });

  await assert.rejects(
    () =>
      recordPayout({
        ownerId,
        circleId,
        input: { roundId, amount: "25.00", clientOperationId: unique("op") },
      }),
    PayoutAccountingIntegrityError,
  );
});

test("the amount is never derived from the live member cohort", async () => {
  // Two obligations frozen for the round, then a THIRD active member is
  // added afterward with no obligation for that round. A live-cohort
  // derivation would expect 75.00; the frozen obligation history says 50.00.
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  await createFixtureMember(fixture.circleId, fixture.ownerId, "LATE", 3);

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "75.00", clientOperationId: unique("op") },
      }),
    PayoutAmountMismatchError,
  );

  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") },
  });
  assert.equal(result.amount, "50.00");
});

test("the amount is never derived from circle.contributionAmount", async () => {
  // Obligations frozen at 25.00 each; the circle's own contributionAmount is
  // then changed to 40.00. Only the frozen obligation sum may be authoritative.
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  await prisma.savingsCircle.update({
    where: { id: fixture.circleId },
    data: { contributionAmount: "40.00" },
  });

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "80.00", clientOperationId: unique("op") },
      }),
    PayoutAmountMismatchError,
  );

  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") },
  });
  assert.equal(result.amount, "50.00");
});

// -------------------------------------------------------------------
// Idempotency / replay
// -------------------------------------------------------------------

test("a duplicate submission of the same operation replays the original payout, no second row", async () => {
  const fixture = await createActiveCircleWithRound();
  const input = { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") };

  const first = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  const second = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  assert.equal(second.id, first.id);
  // No regenerated provenance: same recordedAt, same actor, same operation.
  assert.equal(second.recordedAt, first.recordedAt);
  assert.equal(second.recordedById, first.recordedById);
  assert.equal(second.clientOperationId, first.clientOperationId);
  assert.equal(await prisma.payout.count({ where: { roundId: fixture.roundId } }), 1);
});

test("reusing an operation id against a different round is an intent conflict", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  // PayoutRound has @@unique([circleId, recipientId]) -- a second round needs
  // its own distinct recipient, so it takes the fixture's second member.
  const roundTwoId = await createFixtureRound(fixture.circleId, {
    roundNumber: 2,
    recipientId: fixture.memberIds[1],
    dueDate: new Date("2026-01-15T00:00:00.000Z"),
    status: "UPCOMING",
  });
  for (const memberId of fixture.memberIds) {
    await createFixtureObligation(fixture.circleId, roundTwoId, memberId, { expectedAmount: "25.00" });
  }

  const clientOperationId = unique("op");
  await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "50.00", clientOperationId },
  });

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: roundTwoId, amount: "50.00", clientOperationId },
      }),
    PayoutRecordingOperationConflictError,
  );
  assert.equal(await prisma.payout.count({ where: { roundId: roundTwoId } }), 0);
});

test("reusing an operation id with a different amount (same round) is an intent conflict", async () => {
  const fixture = await createActiveCircleWithRound();
  const clientOperationId = unique("op");

  await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "25.00", clientOperationId },
  });

  await assert.rejects(
    () =>
      recordPayout({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { roundId: fixture.roundId, amount: "30.00", clientOperationId },
      }),
    PayoutRecordingOperationConflictError,
  );
  assert.equal(await prisma.payout.count({ where: { roundId: fixture.roundId } }), 1);
});

test("replaying an operation whose payout has since been CONFIRMED reports the true terminal status", async () => {
  const fixture = await createActiveCircleWithRound();
  const input = { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") };
  const recorded = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  // Manufactured recipient decision -- 7K.4 does not exist yet.
  await prisma.payout.update({
    where: { id: recorded.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedByMemberId: fixture.recipientId,
    },
  });

  const replay = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  assert.equal(replay.id, recorded.id);
  assert.equal(replay.status, "CONFIRMED");
  assert.equal(replay.recordedAt, recorded.recordedAt, "replay must not regenerate recordedAt");

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });
  assert.equal(persisted.status, "CONFIRMED", "a replay must never reset terminal state to RECORDED");
  assert.notEqual(persisted.confirmedAt, null);
});

test("replaying an operation whose payout has since been DISPUTED reports the true terminal status", async () => {
  const fixture = await createActiveCircleWithRound();
  const input = { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") };
  const recorded = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  await prisma.payout.update({
    where: { id: recorded.id },
    data: {
      status: "DISPUTED",
      disputedAt: new Date(),
      disputedByMemberId: fixture.recipientId,
      disputeReason: "Nothing was received.",
    },
  });

  const replay = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  assert.equal(replay.id, recorded.id);
  assert.equal(replay.status, "DISPUTED");

  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });
  assert.equal(persisted.status, "DISPUTED");
  assert.equal(persisted.disputeReason, "Nothing was received.");
});

test("a replay still succeeds after the circle is no longer ACTIVE", async () => {
  const fixture = await createActiveCircleWithRound();
  const input = { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") };
  const recorded = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  for (const status of ["COMPLETED", "ARCHIVED"] as const) {
    await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status } });
    const replay = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
    assert.equal(replay.id, recorded.id, `replay must survive a ${status} circle`);
    assert.equal(replay.recordedAt, recorded.recordedAt);
  }
});

test("recording provenance is never rewritten by a replay", async () => {
  const fixture = await createActiveCircleWithRound();
  const input = { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") };
  const recorded = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });
  const before = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });

  await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  const after = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });
  assert.equal(after.circleId, before.circleId);
  assert.equal(after.roundId, before.roundId);
  assert.equal(after.amount.toFixed(2), before.amount.toFixed(2));
  assert.equal(after.currency, before.currency);
  assert.equal(after.clientOperationId, before.clientOperationId);
  assert.equal(after.recordedById, before.recordedById);
  assert.equal(after.recordedAt.toISOString(), before.recordedAt.toISOString());
  assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString(), "the row must not be written at all");
});

// -------------------------------------------------------------------
// Replay integrity
// -------------------------------------------------------------------

test("a replay whose persisted currency no longer matches the round's obligations is an integrity conflict", async () => {
  const fixture = await createActiveCircleWithRound();
  const input = { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") };
  const recorded = await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  // Manufactured corruption: no writer in this codebase can produce it.
  await prisma.payout.update({ where: { id: recorded.id }, data: { currency: "EUR" } });

  await assert.rejects(
    () => recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input }),
    PayoutRecordingIntegrityConflictError,
  );
  // Never repaired -- the corrupted row is left exactly as found.
  const persisted = await prisma.payout.findUniqueOrThrow({ where: { id: recorded.id } });
  assert.equal(persisted.currency, "EUR");
});

test("a replay whose persisted amount no longer matches the frozen obligation sum is an integrity conflict", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const input = { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") };
  await recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input });

  // The obligation history itself is corrupted after the fact; the replay's
  // submitted intent still matches the payout row, so this is caught only by
  // re-reading authoritative obligation history rather than trusting the row.
  await prisma.contributionObligation.update({
    where: { id: fixture.obligationIds[1] },
    data: { expectedAmount: "30.00" },
  });

  await assert.rejects(
    () => recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input }),
    PayoutRecordingIntegrityConflictError,
  );
});

// -------------------------------------------------------------------
// One payout per round
// -------------------------------------------------------------------

test("a new operation against a round that already has a payout conflicts, whatever that payout's status", async () => {
  for (const status of ["RECORDED", "CONFIRMED", "DISPUTED"] as const) {
    const fixture = await createActiveCircleWithRound();
    const first = await recordPayout({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") },
    });

    if (status !== "RECORDED") {
      await prisma.payout.update({
        where: { id: first.id },
        data:
          status === "CONFIRMED"
            ? { status, confirmedAt: new Date(), confirmedByMemberId: fixture.recipientId }
            : {
                status,
                disputedAt: new Date(),
                disputedByMemberId: fixture.recipientId,
                disputeReason: "Not received.",
              },
      });
    }

    await assert.rejects(
      () =>
        recordPayout({
          ownerId: fixture.ownerId,
          circleId: fixture.circleId,
          input: { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") },
        }),
      PayoutAlreadyRecordedError,
      `expected an already-recorded conflict against a ${status} payout`,
    );

    const rows = await prisma.payout.findMany({ where: { roundId: fixture.roundId } });
    assert.equal(rows.length, 1, "no second payout row may ever be created for a round");
    assert.equal(rows[0].id, first.id, "the original payout must never be replaced");
    assert.equal(rows[0].status, status);
  }
});

// -------------------------------------------------------------------
// Concurrency (real Postgres)
// -------------------------------------------------------------------

test("concurrent duplicate submissions of the SAME operation resolve to exactly one payout row", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const input = { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") };

  const results = await Promise.allSettled([
    recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input }),
    recordPayout({ ownerId: fixture.ownerId, circleId: fixture.circleId, input }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent replays of the same operation must resolve");
  }
  const ids = results.map((result) => (result.status === "fulfilled" ? result.value.id : null));
  assert.equal(ids[0], ids[1], "both calls must resolve to the same payout");

  const rows = await prisma.payout.findMany({ where: { roundId: fixture.roundId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, ids[0]);
});

test("concurrent competing operations for the SAME round leave exactly one payout row", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });

  const results = await Promise.allSettled([
    recordPayout({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op-a") },
    }),
    recordPayout({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op-b") },
    }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one competing operation must win");
  assert.equal(rejected.length, 1, "exactly one competing operation must lose");
  if (rejected[0]?.status === "rejected") {
    assert.ok(
      rejected[0].reason instanceof PayoutAlreadyRecordedError,
      `the loser must receive an already-recorded conflict, got ${String(rejected[0].reason)}`,
    );
  }

  // Final DB state is the truth -- which caller won is not asserted.
  const rows = await prisma.payout.findMany({ where: { roundId: fixture.roundId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "RECORDED");
  if (fulfilled[0]?.status === "fulfilled") {
    assert.equal(rows[0].id, fulfilled[0].value.id);
    assert.equal(rows[0].clientOperationId, fulfilled[0].value.clientOperationId);
  }
});

// -------------------------------------------------------------------
// Architecture
// -------------------------------------------------------------------

test("recording is not gated by round status -- UPCOMING, ACTIVE and CLOSED are all eligible", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const contributorId = await createFixtureMember(circleId, ownerId, "C", 1);
  // PayoutRound has @@unique([circleId, recipientId]) -- each round needs a
  // distinct recipient, separate from the contributor above.
  const recipients = [
    await createFixtureMember(circleId, ownerId, "R1", 2),
    await createFixtureMember(circleId, ownerId, "R2", 3),
    await createFixtureMember(circleId, ownerId, "R3", 4),
  ];

  for (const [index, status] of (["UPCOMING", "ACTIVE", "CLOSED"] as const).entries()) {
    const roundId = await createFixtureRound(circleId, {
      roundNumber: index + 1,
      recipientId: recipients[index],
      dueDate: new Date("2026-01-08T00:00:00.000Z"),
      status,
    });
    await createFixtureObligation(circleId, roundId, contributorId, { expectedAmount: "10.00" });

    const result = await recordPayout({
      ownerId,
      circleId,
      input: { roundId, amount: "10.00", clientOperationId: unique(`op-${status}`) },
    });
    assert.equal(result.status, "RECORDED", `expected recording to succeed for a ${status} round`);

    const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: roundId } });
    assert.equal(round.status, status, "recording must never transition a round's own lifecycle");
  }
});

test("recording is not gated by the round's due date", async () => {
  const fixture = await createActiveCircleWithRound({ dueDate: new Date("2020-01-01T00:00:00.000Z") });
  const result = await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "25.00", clientOperationId: unique("op") },
  });
  assert.equal(result.status, "RECORDED");
});

test("recording mutates nothing but the new Payout row", async () => {
  const fixture = await createActiveCircleWithRound({ memberAmounts: ["25.00", "25.00"] });
  const roundBefore = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  const obligationsBefore = await prisma.contributionObligation.findMany({
    where: { roundId: fixture.roundId },
    orderBy: { id: "asc" },
  });
  const circleBefore = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });

  await recordPayout({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { roundId: fixture.roundId, amount: "50.00", clientOperationId: unique("op") },
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

test("recordPayout has no member-session/auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./payout-recording.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
});

test("recordPayout reads no round status, due date, or live-cohort signal", () => {
  const servicePath = fileURLToPath(new URL("./payout-recording.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /dueDate/);
  assert.doesNotMatch(source, /payoutOrder/);
  assert.doesNotMatch(source, /contributionAmount/);
  assert.doesNotMatch(source, /circleMember/);
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
