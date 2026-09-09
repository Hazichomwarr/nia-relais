import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ContributionConfirmationPaymentRejectedError, confirmContribution } from "@/src/services/contribution-confirmation.service";
import { recordContribution } from "@/src/services/contribution-recording.service";
import {
  ContributionRejectionAmountIntegrityError,
  ContributionRejectionAuthorizationError,
  ContributionRejectionCircleNotActiveError,
  ContributionRejectionCircleNotFoundError,
  ContributionRejectionCurrencyIntegrityError,
  ContributionRejectionIntegrityConflictError,
  ContributionRejectionIntentConflictError,
  ContributionRejectionPaymentConfirmedError,
  ContributionRejectionPaymentNotFoundError,
  ContributionRejectionUnexpectedObligationStateError,
  InvalidRejectionReasonError,
  rejectContribution,
} from "@/src/services/contribution-rejection.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket (contribution-confirmation.service.test.ts,
// contribution-recording.service.test.ts): unique-id-scoped fixtures,
// FK-ordered cleanup in test.after regardless of outcome, before/after
// row counts on unrelated domain tables. No TEST_DATABASE_URL required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "REJECTION_TEST_OWNER", email: `${unique("rejection-test-owner")}@example.invalid` },
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
      name: unique("RejectionTestCircle"),
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
 * for expectedAmount, and one already-RECORDED payment against it (via
 * the real 7J.2 recordContribution) ready to be rejected. */
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

test("a valid rejection transitions the payment to REJECTED, obligation stays OPEN", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const result = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Amount was never handed over." },
  });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.rejectedById, fixture.ownerId);
  assert.equal(result.rejectionReason, "Amount was never handed over.");
  assert.ok(result.rejectedAt);

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "REJECTED");

  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligation.status, "OPEN");
  assert.equal(obligation.fulfilledAt, null);
});

test("an empty rejection reason is rejected by the service's own defensive check", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "   " },
      }),
    InvalidRejectionReasonError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "RECORDED");
});

test("rejection provenance is populated; recording provenance and amount/currency are unchanged", async () => {
  const fixture = await createRecordedContributionFixture("40.00");
  const before = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });

  await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Wrong amount." },
  });

  const after = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(after.recordedAt.getTime(), before.recordedAt.getTime());
  assert.equal(after.recordedById, before.recordedById);
  assert.ok(after.amount.equals(before.amount));
  assert.equal(after.currency, before.currency);
  assert.equal(after.clientOperationId, before.clientOperationId);
});

test("a CONFIRMED payment cannot be rejected", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "too late" },
      }),
    ContributionRejectionPaymentConfirmedError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "CONFIRMED");
});

test("rejecting as a non-owner is rejected with ContributionRejectionAuthorizationError", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const otherOwnerId = await createOwner();

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: otherOwnerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionAuthorizationError,
  );
});

test("a nonexistent circle is rejected with ContributionRejectionCircleNotFoundError", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () =>
      rejectContribution({
        ownerId,
        circleId: "not-a-real-circle-id",
        input: { paymentId: "not-a-real-payment-id", rejectionReason: "reason" },
      }),
    ContributionRejectionCircleNotFoundError,
  );
});

test("a foreign payment (belonging to a different circle) collapses to the same not-found error as a nonexistent one", async () => {
  const fixtureA = await createRecordedContributionFixture("25.00");
  const fixtureB = await createRecordedContributionFixture("25.00");

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixtureB.ownerId,
        circleId: fixtureB.circleId,
        input: { paymentId: fixtureA.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionPaymentNotFoundError,
  );
});

test("a malformed/nonexistent paymentId is rejected as not found, not a crash", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId,
        circleId,
        input: { paymentId: "not-a-real-payment-id!!", rejectionReason: "reason" },
      }),
    ContributionRejectionPaymentNotFoundError,
  );
});

test("a non-ACTIVE circle rejects a fresh rejection attempt", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: "COMPLETED" } });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionCircleNotActiveError,
  );
});

test("a duplicate rejection with the exact same reason replays the existing REJECTED state without writing again", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const first = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Wrong amount handed over." },
  });
  const second = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Wrong amount handed over." },
  });

  assert.deepEqual(second, first);
});

for (const laterStatus of ["COMPLETED", "ARCHIVED"] as const) {
  test(`replaying a rejection succeeds even after the circle later becomes ${laterStatus}`, async () => {
    const fixture = await createRecordedContributionFixture("25.00");
    const first = await rejectContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { paymentId: fixture.paymentId, rejectionReason: "Wrong amount handed over." },
    });
    await prisma.savingsCircle.update({ where: { id: fixture.circleId }, data: { status: laterStatus } });

    const replay = await rejectContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { paymentId: fixture.paymentId, rejectionReason: "Wrong amount handed over." },
    });
    assert.deepEqual(replay, first);
  });
}

test("replay writes no new timestamps -- rejectedAt is identical across replays", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
  });
  const before = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
  });
  const after = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });

  assert.equal(after.rejectedAt?.getTime(), before.rejectedAt?.getTime());
});

test("replaying rejection with a DIFFERENT reason is an intent conflict, never a silent overwrite", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Original reason." },
  });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "A completely different reason." },
      }),
    ContributionRejectionIntentConflictError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.rejectionReason, "Original reason.");
});

test("a persisted amount mismatch fails safely as an integrity error, without changing either row", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({ where: { id: fixture.paymentId }, data: { amount: "26.00" } });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionAmountIntegrityError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "RECORDED");
});

test("a persisted currency mismatch fails safely as an integrity error, without changing either row", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({ where: { id: fixture.paymentId }, data: { currency: "EUR" } });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionCurrencyIntegrityError,
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
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionUnexpectedObligationStateError,
  );

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "RECORDED");
});

// 7J.4.1: a REJECTED payment next to a FULFILLED obligation is NOT
// inherently corrupted -- the legitimate sequence record A -> reject A ->
// record B -> confirm B leaves EXACTLY this shape, with A permanently and
// correctly REJECTED. The tests below replace the old (incorrect)
// "REJECTED + FULFILLED is always corrupted" assumption.

test("7J.4.1: a legitimate rejection replay succeeds after a later, different payment fulfills the obligation (real service chain)", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const reasonA = "Wrong amount handed over.";

  const rejectedA = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: reasonA },
  });
  assert.equal(rejectedA.status, "REJECTED");

  const recordedB = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op-b") },
  });
  const confirmedB = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: recordedB.id },
  });
  assert.equal(confirmedB.payment.status, "CONFIRMED");
  assert.equal(confirmedB.obligation.status, "FULFILLED");

  const paymentBBefore = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: recordedB.id } });
  const obligationBefore = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });

  // The actual correction under test: replaying A's rejection now that
  // the obligation is FULFILLED (by a completely different payment) must
  // still succeed.
  const replayA = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: reasonA },
  });

  assert.deepEqual(replayA, rejectedA);
  assert.equal(replayA.status, "REJECTED");
  assert.equal(replayA.rejectionReason, reasonA);

  // B and the obligation must be completely untouched by A's replay.
  const paymentBAfter = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: recordedB.id } });
  const obligationAfter = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.deepEqual(paymentBAfter, paymentBBefore);
  assert.deepEqual(obligationAfter, obligationBefore);
  assert.equal(obligationAfter.status, "FULFILLED");
  assert.equal(paymentBAfter.status, "CONFIRMED");

  // A's own row is unchanged by the replay too.
  const paymentA = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(paymentA.status, "REJECTED");
  assert.equal(paymentA.rejectionReason, reasonA);
});

test("7J.4.1: after the obligation is fulfilled by a different payment, replaying A with a mismatched reason is still an intent conflict", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Original reason." },
  });
  const recordedB = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op-b") },
  });
  await confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: recordedB.id } });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "A different reason." },
      }),
    ContributionRejectionIntentConflictError,
  );
});

test("7J.4.1: contradictory confirmation provenance on the SAME row (REJECTED payment also carrying confirmedAt/confirmedById) is a corrupted-replay integrity error", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({
    where: { id: fixture.paymentId },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedById: fixture.ownerId,
      rejectionReason: "reason",
      // Deliberately corrupted: a real payment is terminal in exactly one
      // direction (contribution-state.ts) -- never both REJECTED and
      // CONFIRMED on the same row. Never produced by this codebase's own
      // writers, simulated here to prove replay refuses to paper over it.
      confirmedAt: new Date(),
      confirmedById: fixture.ownerId,
    },
  });

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionIntegrityConflictError,
  );
});

test("7J.4.1: malformed rejection provenance (REJECTED status but missing rejectedById) is a corrupted-replay integrity error", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.$executeRaw`UPDATE "ContributionPayment" SET "status" = 'REJECTED', "rejectedAt" = NOW(), "rejectedById" = NULL, "rejectionReason" = 'reason' WHERE "id" = ${fixture.paymentId}`;

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionIntegrityConflictError,
  );
});

test("7J.4.1: an internally-inconsistent obligation (FULFILLED with a null fulfilledAt) is a corrupted-replay integrity error", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await prisma.contributionPayment.update({
    where: { id: fixture.paymentId },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: fixture.ownerId, rejectionReason: "reason" },
  });
  await prisma.$executeRaw`UPDATE "ContributionObligation" SET "status" = 'FULFILLED', "fulfilledAt" = NULL WHERE "id" = ${fixture.obligationId}`;

  await assert.rejects(
    () =>
      rejectContribution({
        ownerId: fixture.ownerId,
        circleId: fixture.circleId,
        input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
      }),
    ContributionRejectionIntegrityConflictError,
  );
});

test("two concurrent rejections of the same payment resolve safely -- exactly one write, both calls succeed", async () => {
  const fixture = await createRecordedContributionFixture("25.00");

  const results = await Promise.allSettled([
    rejectContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId, rejectionReason: "same reason" } }),
    rejectContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId, rejectionReason: "same reason" } }),
  ]);

  for (const result of results) {
    assert.equal(result.status, "fulfilled", "both concurrent rejections with the same reason must resolve successfully");
  }

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  assert.equal(payment.status, "REJECTED");
  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligation.status, "OPEN");
});

test("real confirm-vs-reject race: exactly one terminal outcome, never both, never mixed provenance", async () => {
  const fixture = await createRecordedContributionFixture("25.00");

  const [confirmOutcome, rejectOutcome] = await Promise.allSettled([
    confirmContribution({ ownerId: fixture.ownerId, circleId: fixture.circleId, input: { paymentId: fixture.paymentId } }),
    rejectContribution({
      ownerId: fixture.ownerId,
      circleId: fixture.circleId,
      input: { paymentId: fixture.paymentId, rejectionReason: "Racing rejection." },
    }),
  ]);

  const payment = await prisma.contributionPayment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
  const obligation = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });

  if (payment.status === "CONFIRMED") {
    // A. Confirmation won.
    assert.equal(obligation.status, "FULFILLED");
    assert.ok(payment.confirmedAt);
    assert.equal(payment.rejectedAt, null);
    assert.equal(confirmOutcome.status, "fulfilled");
    assert.equal(rejectOutcome.status, "rejected");
    if (rejectOutcome.status === "rejected") {
      assert.ok(rejectOutcome.reason instanceof ContributionRejectionPaymentConfirmedError);
    }
  } else if (payment.status === "REJECTED") {
    // B. Rejection won.
    assert.equal(obligation.status, "OPEN");
    assert.equal(obligation.fulfilledAt, null);
    assert.ok(payment.rejectedAt);
    assert.equal(payment.confirmedAt, null);
    assert.equal(rejectOutcome.status, "fulfilled");
    assert.equal(confirmOutcome.status, "rejected");
    if (confirmOutcome.status === "rejected") {
      assert.ok(confirmOutcome.reason instanceof ContributionConfirmationPaymentRejectedError);
    }
  } else {
    assert.fail(`unexpected terminal payment status: ${payment.status}`);
  }
});

test("a fresh recording after rejection succeeds end-to-end via 7J.2 -- rejected row intact, obligation OPEN until a later confirmation", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const rejected = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "Wrong amount handed over." },
  });
  assert.equal(rejected.status, "REJECTED");

  const freshPayment = await recordContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { obligationId: fixture.obligationId, amount: "25.00", clientOperationId: unique("op-fresh") },
  });
  assert.equal(freshPayment.status, "RECORDED");
  assert.notEqual(freshPayment.id, fixture.paymentId);

  const rows = await prisma.contributionPayment.findMany({ where: { obligationId: fixture.obligationId } });
  assert.equal(rows.length, 2, "exactly one active-slot payment plus the preserved rejected row");
  const rejectedRow = rows.find((row) => row.id === fixture.paymentId);
  assert.equal(rejectedRow?.status, "REJECTED");
  assert.equal(rejectedRow?.rejectionReason, "Wrong amount handed over.");

  const obligationAfterFreshRecord = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: fixture.obligationId } });
  assert.equal(obligationAfterFreshRecord.status, "OPEN", "obligation stays OPEN until a later confirmation, not merely a fresh recording");

  const confirmed = await confirmContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: freshPayment.id },
  });
  assert.equal(confirmed.obligation.status, "FULFILLED");
});

test("rejection creates no new ContributionPayment row and never touches round or circle lifecycle", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
  });

  const paymentCount = await prisma.contributionPayment.count({ where: { obligationId: fixture.obligationId } });
  assert.equal(paymentCount, 1);

  const round = await prisma.payoutRound.findUniqueOrThrow({ where: { id: fixture.roundId } });
  assert.equal(round.status, "UPCOMING");
  const circle = await prisma.savingsCircle.findUniqueOrThrow({ where: { id: fixture.circleId } });
  assert.equal(circle.status, "ACTIVE");
});

test("the serialized result exposes only the whitelisted fields -- no raw Prisma model, no auth fields", async () => {
  const fixture = await createRecordedContributionFixture("25.00");
  const result = await rejectContribution({
    ownerId: fixture.ownerId,
    circleId: fixture.circleId,
    input: { paymentId: fixture.paymentId, rejectionReason: "reason" },
  });

  assert.deepEqual(
    Object.keys(result).sort(),
    ["amount", "circleId", "currency", "id", "obligationId", "recordedAt", "recordedById", "rejectedAt", "rejectedById", "rejectionReason", "status"].sort(),
  );
});

test("rejectContribution has no member-session/auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./contribution-rejection.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
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
