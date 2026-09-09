import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ContributionConfirmationAmountIntegrityError,
  ContributionConfirmationAuthorizationError,
  ContributionConfirmationCircleNotActiveError,
  ContributionConfirmationCircleNotFoundError,
  ContributionConfirmationCurrencyIntegrityError,
  ContributionConfirmationIntegrityConflictError,
  ContributionConfirmationPaymentNotFoundError,
  ContributionConfirmationPaymentRejectedError,
  ContributionConfirmationUnexpectedObligationStateError,
  confirmContribution,
} from "@/src/services/contribution-confirmation.service";
import {
  ContributionObligationAlreadyFulfilledError,
  ContributionObligationAlreadyRecordedError,
  recordContribution,
} from "@/src/services/contribution-recording.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket (contribution-recording.service.test.ts, circle-activation-guard
// .test.ts): unique-id-scoped fixtures, FK-ordered cleanup in test.after
// regardless of outcome, before/after row counts on unrelated domain
// tables. No TEST_DATABASE_URL required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "CONFIRMATION_TEST_OWNER", email: `${unique("confirmation-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

async function createFixtureCircle(ownerId: string, status: CircleStatus, contributionAmount: string) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("ConfirmationTestCircle"),
      currency: "USD",
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

async function createFixtureRound(circleId: string, roundNumber: number, recipientId: string) {
  const round = await prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber,
      recipientId,
      dueDate: new Date("2026-01-08T00:00:00.000Z"),
      status: "UPCOMING",
    },
    select: { id: true },
  });
  return round.id;
}

async function createFixtureObligation(circleId: string, roundId: string, memberId: string, expectedAmount: string) {
  const obligation = await prisma.contributionObligation.create({
    data: {
      circleId,
      roundId,
      memberId,
      expectedAmount,
      currency: "USD",
      dueDate: new Date("2026-01-08T00:00:00.000Z"),
      status: "OPEN",
    },
    select: { id: true },
  });
  return obligation.id;
}

/** ACTIVE circle, one contributing member, one round, one OPEN obligation
 * for expectedAmount, and one already-RECORDED payment against it (via the
 * real 7J.2 recordContribution) ready to be confirmed. */
async function createRecordedContributionFixture(expectedAmount = "25.00") {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", expectedAmount);
  const memberId = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, memberId);
  const obligationId = await createFixtureObligation(circleId, roundId, memberId, expectedAmount);
  const recorded = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: expectedAmount, clientOperationId: unique("op") },
  });
  return { ownerId, circleId, memberId, roundId, obligationId, paymentId: recorded.id };
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

test("a valid confirmation transitions the payment to CONFIRMED and the obligation to FULFILLED", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const result = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });

  assert.equal(result.payment.status, "CONFIRMED");
  assert.equal(result.payment.confirmedById, fixture.ownerId);
  assert.ok(result.payment.confirmedAt);
  assert.equal(result.obligation.status, "FULFILLED");
  assert.ok(result.obligation.fulfilledAt);

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "CONFIRMED");
  assert.equal(payment.confirmedById, fixture.ownerId);
  assert.ok(payment.confirmedAt);

  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligation.status, "FULFILLED");
  assert.ok(obligation.fulfilledAt);
});

test("confirmation provenance is populated; recording provenance and amount/currency are unchanged", async () => {
  const fixture = await createRecordedContributionFixture("40.00");
  const before = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });

  await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });

  const after = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(after.recordedAt.getTime(), before.recordedAt.getTime());
  assert.equal(after.recordedById, before.recordedById);
  assert.ok(after.amount.equals(before.amount));
  assert.equal(after.currency, before.currency);
  assert.equal(after.clientOperationId, before.clientOperationId);
});

test("confirming as a non-owner is rejected with ContributionConfirmationAuthorizationError", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: otherOwnerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationAuthorizationError,
  );
});

test("a nonexistent circle is rejected with ContributionConfirmationCircleNotFoundError", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () =>
      confirmContribution({
        ownerId,
        circleId: "not-a-real-circle-id",
        input: { paymentId: "not-a-real-payment-id" },
      }),
    ContributionConfirmationCircleNotFoundError,
  );
});

test("a foreign payment (belonging to a different circle) collapses to the same not-found error as a nonexistent one", async () => {
  const fixtureA = await createRecordedContributionFixture("25.00");
  const fixtureB = await createRecordedContributionFixture("25.00");

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixtureB.ownerId,
        circleId: fixtureB.circleId,
        input: { paymentId: fixtureA.paymentId },
      }),
    ContributionConfirmationPaymentNotFoundError,
  );
});

test("a malformed/nonexistent paymentId is rejected as not found, not a crash", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId,
        circleId,
        input: { paymentId: "not-a-real-payment-id!!" },
      }),
    ContributionConfirmationPaymentNotFoundError,
  );
});

test("a non-ACTIVE circle rejects a fresh confirmation attempt", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationCircleNotActiveError,
  );
});

test("a REJECTED payment cannot be confirmed", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({
    where: { id: fixture.paymentId },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: fixture.ownerId, rejectionReason: "reason" },
  });

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationPaymentRejectedError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "REJECTED");
});

test("a duplicate confirmation replays the existing CONFIRMED state without writing again", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const first = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });
  const second = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });

  assert.deepEqual(second, first);
});

test("replaying a confirmation succeeds even after the circle later becomes COMPLETED", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const first = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  const replay = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });
  assert.deepEqual(replay, first);
});

test("replay writes no new timestamps -- confirmedAt is identical across replays", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } });
  const before = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } });
  const after = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });

  assert.equal(after.confirmedAt?.getTime(), before.confirmedAt?.getTime());
});

test("a persisted amount mismatch fails safely as an integrity error, without changing either row", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({ where: { id: fixture.paymentId }, data: { amount: "26.00" } });

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationAmountIntegrityError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "RECORDED");
  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligation.status, "OPEN");
});

test("a persisted currency mismatch fails safely as an integrity error, without changing either row", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({ where: { id: fixture.paymentId }, data: { currency: "EUR" } });

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationCurrencyIntegrityError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "RECORDED");
});

test("a RECORDED payment referencing an already-FULFILLED obligation fails as an unexpected-state error, payment stays RECORDED", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionObligation.update({
    where: { id: fixture.obligationId },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationUnexpectedObligationStateError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "RECORDED");
});

test("a CONFIRMED payment next to a still-OPEN obligation is a corrupted-replay integrity error", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({
    where: { id: fixture.paymentId },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: fixture.ownerId },
  });
  // Obligation deliberately left OPEN -- simulates a corrupted/partial
  // prior write, never produced by confirmContribution itself.

  await assert.rejects(
    () =>
      confirmContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId },
      }),
    ContributionConfirmationIntegrityConflictError,
  );
});

test("two concurrent confirmations of the same payment resolve safely -- exactly one write, both calls succeed", async () => {
  const fixture = await createRecordedContributionFixture("25.00");

  const results = await Promise.allSettled([
    confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } }),
    confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent confirmations of the same payment must resolve successfully");
  }

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "CONFIRMED");
  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligation.status, "FULFILLED");
});

test("a real race: confirming a payment while a competing fresh recording attempt targets the same obligation", async () => {
  const fixture = await createRecordedContributionFixture("25.00");

  const [confirmOutcome, recordOutcome] = await Promise.allSettled([
    confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } }),
    recordContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op-race") },
    }),
  ]);

  // The circle row lock (shared by both services) serializes them --
  // confirmation always succeeds (nothing can block it once it starts,
  // since the payment it targets already exists and is RECORDED), and the
  // competing recording attempt always loses, regardless of ordering: it
  // sees either the still-RECORDED payment (already-recorded conflict) or
  // the now-CONFIRMED one (already-fulfilled conflict).
  assert.equal(confirmOutcome.status, "fulfilled");
  assert.equal(recordOutcome.status, "rejected");
  if (recordOutcome.status === "rejected") {
    assert.ok(
      recordOutcome.reason instanceof ContributionObligationAlreadyRecordedError ||
        recordOutcome.reason instanceof ContributionObligationAlreadyFulfilledError,
    );
  }

  const paymentCount = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(paymentCount, 1, "the competing recording attempt must never create a second payment row");
});

test("confirmation creates no new ContributionPayment row and never touches round or circle lifecycle", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } });

  const paymentCount = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(paymentCount, 1);

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  assert.equal(round.status, "UPCOMING");
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

test("a REJECTED row elsewhere on the same circle is never mutated by an unrelated confirmation", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const memberTwoId = await createFixtureMember(fixture.circleId, fixture.ownerId, "B", 2);
  const roundTwoId = await createFixtureRound(fixture.circleId, 2, memberTwoId);
  const obligationTwoId = await createFixtureObligation(fixture.circleId, roundTwoId, fixture.memberId, "25.00");
  const secondPayment = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: obligationTwoId, amount: "25.00", clientOperationId: unique("op") },
  });
  await prisma.contributionPayment.update({
    where: { id: secondPayment.id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: fixture.ownerId, rejectionReason: "unrelated" },
  });

  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } });

  const rejectedRow = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: secondPayment.id } });
  assert.equal(rejectedRow.status, "REJECTED");
  assert.equal(rejectedRow.rejectionReason, "unrelated");
});

test("the serialized result exposes only the whitelisted payment/obligation fields -- no raw Prisma model, no auth fields", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const result = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId },
  });

  assert.deepEqual(Object.keys(result).sort(), ["obligation", "payment"]);
  assert.deepEqual(
    Object.keys(result.payment).sort(),
    ["amount", "circleId", "confirmedAt", "confirmedById", "currency", "id", "obligationId", "recordedAt", "recordedById", "status"].sort(),
  );
  assert.deepEqual(Object.keys(result.obligation).sort(), ["fulfilledAt", "id", "status"].sort());
});

test("confirmContribution has no member-session/auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./contribution-confirmation.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
});

// Deferred races (7J.3 section 9): confirmContribution's own competing
// writer is rejectContribution (7J.4) and a future circle
// completion/archive service -- neither exists yet in this codebase, and
// none is invented here just to manufacture a test. Once 7J.4 ships,
// add: a real confirm-vs-reject race on the same payment (the CAS
// contract already makes exactly one win deterministically); once a
// circle completion/archive writer exists, add: confirmation racing that
// writer's own circle-row lock acquisition. Both races are already
// structurally covered by this service's reliance on the SAME
// lockSavingsCircleForUpdate serialization boundary every other
// circle-scoped writer uses -- see contribution-confirmation.service.ts's
// own module comment.

test("this suite makes no financial/domain lifecycle mutation outside the SUSU tables it created", async () => {
  const finalCounts = {
    users: (await prisma.user.count()) - ownedResourceIds.userIds.size,
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});
