import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { confirmContribution } from "@/src/services/contribution-confirmation.service";
import {
  OwnerContributionsAuthorizationError,
  OwnerContributionsCircleNotEligibleError,
  OwnerContributionsCircleNotFoundError,
  OwnerContributionsRoundNotFoundError,
  getOwnerCircleContributions,
} from "@/src/services/contribution-owner-read.service";
import { recordContribution } from "@/src/services/contribution-recording.service";
import { rejectContribution } from "@/src/services/contribution-rejection.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU
// ticket: unique-id-scoped fixtures, FK-ordered cleanup in test.after
// regardless of outcome, before/after row counts on unrelated domain
// tables. No TEST_DATABASE_URL required.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "OWNER_READ_TEST_OWNER", email: `${unique("owner-read-test-owner")}@example.invalid` },
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
      name: unique("OwnerReadTestCircle"),
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
    select: { id: true, memberCode: true, displayName: true },
  });
  return member;
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

test("the owner can read their own circle's contribution detail", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "25.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "25.00");

  const result = await getOwnerCircleContributions({ ownerId, circleId });

  assert.equal(result.circle.id, circleId);
  assert.equal(result.circle.status, "ACTIVE");
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0]?.id, roundId);
  assert.equal(result.obligations.length, 1);
  assert.equal(result.obligations[0]?.id, obligationId);
  assert.equal(result.obligations[0]?.memberDisplayName, "A");
  assert.equal(result.obligations[0]?.memberCode, member.memberCode);
  assert.deepEqual(result.payments, []);
});

test("a cross-owner request is denied with OwnerContributionsAuthorizationError", async () => {
  const ownerId = await createOwner();
  const otherOwnerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");

  await assert.rejects(
    () => getOwnerCircleContributions({ ownerId: otherOwnerId, circleId }),
    OwnerContributionsAuthorizationError,
  );
});

test("a nonexistent circle is rejected with OwnerContributionsCircleNotFoundError", async () => {
  const ownerId = await createOwner();
  await assert.rejects(
    () => getOwnerCircleContributions({ ownerId, circleId: "not-a-real-circle-id" }),
    OwnerContributionsCircleNotFoundError,
  );
});

test("a DRAFT circle is rejected with OwnerContributionsCircleNotEligibleError", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "DRAFT", "10.00");

  await assert.rejects(
    () => getOwnerCircleContributions({ ownerId, circleId }),
    OwnerContributionsCircleNotEligibleError,
  );
});

for (const status of ["CANCELLED", "ARCHIVED"] as const) {
  test(`a ${status} circle is rejected with OwnerContributionsCircleNotEligibleError`, async () => {
    const ownerId = await createOwner();
    const circleId = await createFixtureCircle(ownerId, status, "10.00");

    await assert.rejects(
      () => getOwnerCircleContributions({ ownerId, circleId }),
      OwnerContributionsCircleNotEligibleError,
    );
  });
}

test("a COMPLETED circle is now eligible (7L.3 P1 fix) -- historical contribution data reads successfully", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberA = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, memberA.id);
  await createFixtureObligation(circleId, roundId, memberA.id, "10.00");
  await prisma.savingsCircle.update({ where: { id: circleId }, data: { status: "COMPLETED", completedAt: new Date(), completedById: ownerId } });

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  assert.equal(result.circle.status, "COMPLETED");
  assert.equal(result.obligations.length, 1);
});

test("a foreign roundId (belonging to a different circle) is rejected with the same not-found error as a nonexistent one", async () => {
  const ownerId = await createOwner();
  const circleA = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const circleB = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberA = await createFixtureMember(circleA, ownerId, "A", 1);
  const foreignRoundId = await createFixtureRound(circleA, 1, memberA.id);

  await assert.rejects(
    () => getOwnerCircleContributions({ ownerId, circleId: circleB, roundId: foreignRoundId }),
    OwnerContributionsRoundNotFoundError,
  );

  await assert.rejects(
    () => getOwnerCircleContributions({ ownerId, circleId: circleB, roundId: "not-a-real-round-id" }),
    OwnerContributionsRoundNotFoundError,
  );
});

test("without roundId, all persisted rounds and obligations are returned; with roundId, only that round's", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const memberA = await createFixtureMember(circleId, ownerId, "A", 1);
  const memberB = await createFixtureMember(circleId, ownerId, "B", 2);
  const roundOneId = await createFixtureRound(circleId, 1, memberA.id);
  const roundTwoId = await createFixtureRound(circleId, 2, memberB.id);
  await createFixtureObligation(circleId, roundOneId, memberA.id, "10.00");
  await createFixtureObligation(circleId, roundOneId, memberB.id, "10.00");
  await createFixtureObligation(circleId, roundTwoId, memberA.id, "10.00");
  await createFixtureObligation(circleId, roundTwoId, memberB.id, "10.00");

  const all = await getOwnerCircleContributions({ ownerId, circleId });
  assert.equal(all.rounds.length, 2);
  assert.equal(all.obligations.length, 4);

  const scoped = await getOwnerCircleContributions({ ownerId, circleId, roundId: roundOneId });
  assert.equal(scoped.rounds.length, 1);
  assert.equal(scoped.rounds[0]?.id, roundOneId);
  assert.equal(scoped.obligations.length, 2);
  assert.ok(scoped.obligations.every((obligation) => obligation.roundId === roundOneId));
});

test("persisted round/obligation facts come from the rows themselves, not derived from due dates or member order", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  await prisma.payoutRound.update({ where: { id: roundId }, data: { status: "CLOSED" } });
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "10.00");

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  assert.equal(result.rounds[0]?.status, "CLOSED");
  assert.equal(result.obligations.find((o) => o.id === obligationId)?.status, "OPEN");
});

test("exact Decimal accounting: CONFIRMED counts, RECORDED and REJECTED do not, outstanding clamps to zero", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "30.00");
  const memberA = await createFixtureMember(circleId, ownerId, "A", 1);
  const memberB = await createFixtureMember(circleId, ownerId, "B", 2);
  const roundId = await createFixtureRound(circleId, 1, memberA.id);

  const obligationConfirmed = await createFixtureObligation(circleId, roundId, memberA.id, "30.00");
  const confirmedPayment = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId: obligationConfirmed, amount: "30.00", clientOperationId: unique("op-confirmed") },
  });
  await confirmContribution({ ownerId, circleId, input: { paymentId: confirmedPayment.id } });

  const obligationRecordedOnly = await createFixtureObligation(circleId, roundId, memberB.id, "30.00");
  await recordContribution({
    ownerId,
    circleId,
    input: { obligationId: obligationRecordedOnly, amount: "30.00", clientOperationId: unique("op-recorded") },
  });

  const result = await getOwnerCircleContributions({ ownerId, circleId });

  const confirmedResult = result.obligations.find((o) => o.id === obligationConfirmed);
  assert.equal(confirmedResult?.confirmedAmount, "30.00");
  assert.equal(confirmedResult?.outstandingAmount, "0.00");
  assert.equal(confirmedResult?.status, "FULFILLED");

  const recordedOnlyResult = result.obligations.find((o) => o.id === obligationRecordedOnly);
  assert.equal(recordedOnlyResult?.confirmedAmount, "0.00", "RECORDED does not count toward confirmedAmount");
  assert.equal(recordedOnlyResult?.outstandingAmount, "30.00");
  assert.equal(recordedOnlyResult?.status, "OPEN");
});

test("REJECTED payments never count toward confirmedAmount", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "20.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "20.00");

  const recorded = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "20.00", clientOperationId: unique("op") },
  });
  await rejectContribution({ ownerId, circleId, input: { paymentId: recorded.id, rejectionReason: "wrong amount" } });

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  const obligationResult = result.obligations.find((o) => o.id === obligationId);
  assert.equal(obligationResult?.confirmedAmount, "0.00");
  assert.equal(obligationResult?.outstandingAmount, "20.00");
});

test("a rejected attempt remains visible in payment history after a later payment fulfills the obligation", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "20.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "20.00");

  const rejectedPayment = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "20.00", clientOperationId: unique("op-a") },
  });
  await rejectContribution({ ownerId, circleId, input: { paymentId: rejectedPayment.id, rejectionReason: "wrong amount" } });

  const confirmedPayment = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "20.00", clientOperationId: unique("op-b") },
  });
  await confirmContribution({ ownerId, circleId, input: { paymentId: confirmedPayment.id } });

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  const obligationPayments = result.payments.filter((payment) => payment.obligationId === obligationId);
  assert.equal(obligationPayments.length, 2, "both the rejected attempt and the confirmed attempt must be visible");

  const rejectedResult = obligationPayments.find((payment) => payment.id === rejectedPayment.id);
  assert.equal(rejectedResult?.status, "REJECTED");
  assert.equal(rejectedResult?.rejectionReason, "wrong amount");

  const confirmedResult = obligationPayments.find((payment) => payment.id === confirmedPayment.id);
  assert.equal(confirmedResult?.status, "CONFIRMED");

  const obligationResult = result.obligations.find((o) => o.id === obligationId);
  assert.equal(obligationResult?.status, "FULFILLED");
  assert.equal(obligationResult?.confirmedAmount, "20.00");
});

test("payment history is ordered deterministically by (recordedAt, id)", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "20.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "20.00");

  const first = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "20.00", clientOperationId: unique("op-1") },
  });
  await rejectContribution({ ownerId, circleId, input: { paymentId: first.id, rejectionReason: "first" } });
  const second = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "20.00", clientOperationId: unique("op-2") },
  });
  await rejectContribution({ ownerId, circleId, input: { paymentId: second.id, rejectionReason: "second" } });
  const third = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "20.00", clientOperationId: unique("op-3") },
  });

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  const obligationPayments = result.payments.filter((payment) => payment.obligationId === obligationId);
  assert.deepEqual(
    obligationPayments.map((payment) => payment.id),
    [first.id, second.id, third.id],
  );
});

test("persisted obligation status is returned distinct from the derived accounting -- both visible, never merged", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "15.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "15.00");

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  const obligationResult = result.obligations.find((o) => o.id === obligationId);
  assert.equal(obligationResult?.status, "OPEN");
  assert.equal(obligationResult?.fulfilledAt, null);
  assert.equal(obligationResult?.confirmedAmount, "0.00");
  assert.equal(obligationResult?.outstandingAmount, "15.00");
});

test("no PIN hash, credential, or session field is ever exposed", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  await createFixtureObligation(circleId, roundId, member.id, "10.00");

  const result = await getOwnerCircleContributions({ ownerId, circleId });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /pinHash/i);
  assert.doesNotMatch(serialized, /credentialVersion/i);
  assert.doesNotMatch(serialized, /session/i);
});

test("the result exposes only the whitelisted fields at every level", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  const obligationId = await createFixtureObligation(circleId, roundId, member.id, "10.00");
  const payment = await recordContribution({
    ownerId,
    circleId,
    input: { obligationId, amount: "10.00", clientOperationId: unique("op") },
  });

  const result = await getOwnerCircleContributions({ ownerId, circleId });

  assert.deepEqual(Object.keys(result).sort(), ["circle", "obligations", "payments", "rounds"]);
  assert.deepEqual(Object.keys(result.circle).sort(), ["currency", "id", "name", "status"]);
  assert.deepEqual(Object.keys(result.rounds[0]!).sort(), ["dueDate", "id", "recipientDisplayName", "roundNumber", "status"]);
  assert.deepEqual(
    Object.keys(result.obligations[0]!).sort(),
    ["confirmedAmount", "currency", "dueDate", "expectedAmount", "fulfilledAt", "id", "memberCode", "memberDisplayName", "memberId", "outstandingAmount", "roundId", "status"].sort(),
  );
  assert.deepEqual(
    Object.keys(result.payments[0]!).sort(),
    ["amount", "clientOperationId", "confirmedAt", "confirmedById", "currency", "id", "obligationId", "recordedAt", "recordedById", "rejectedAt", "rejectedById", "rejectionReason", "status"].sort(),
  );
  void payment;
});

test("this read model performs no writes", async () => {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, "ACTIVE", "10.00");
  const member = await createFixtureMember(circleId, ownerId, "A", 1);
  const roundId = await createFixtureRound(circleId, 1, member.id);
  await createFixtureObligation(circleId, roundId, member.id, "10.00");

  const paymentCountBefore = await prisma.contributionPayment.count();
  const obligationCountBefore = await prisma.contributionObligation.count();
  await getOwnerCircleContributions({ ownerId, circleId });
  const paymentCountAfter = await prisma.contributionPayment.count();
  const obligationCountAfter = await prisma.contributionObligation.count();

  assert.equal(paymentCountAfter, paymentCountBefore);
  assert.equal(obligationCountAfter, obligationCountBefore);
});

test("getOwnerCircleContributions has no member-session/auth dependency of its own", () => {
  const servicePath = fileURLToPath(new URL("./contribution-owner-read.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
  assert.doesNotMatch(source, /next\/headers/);
  assert.doesNotMatch(source, /next\/navigation/);
});

test("the owner-read repository does not widen circle-member-dashboard.repository.ts's member-facing selects", () => {
  const memberRepoPath = fileURLToPath(new URL("../repositories/circle-member-dashboard.repository.ts", import.meta.url));
  const source = readFileSync(memberRepoPath, "utf8");
  assert.doesNotMatch(source, /memberCode/);
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
