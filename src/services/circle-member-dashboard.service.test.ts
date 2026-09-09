import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CircleMemberDashboardCircleNotEligibleError,
  CircleMemberDashboardCircleNotFoundError,
  CircleMemberDashboardMemberNotActiveError,
  CircleMemberDashboardMemberNotFoundError,
  getCircleMemberDashboard,
} from "@/src/services/circle-member-dashboard.service";
import { prisma } from "@/src/prisma";

// Live-database fixture tests, same methodology as every prior SUSU ticket
// (circle-member-session.service.test.ts, circle-member-auth-rate-limit
// .service.test.ts): unique-id-scoped fixtures, FK-ordered cleanup in
// test.after regardless of outcome, and before/after row counts on
// unrelated domain tables. No TEST_DATABASE_URL is required (nothing here
// is destructive/broad), and no destructive cleanup tests are run.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "DASHBOARD_TEST_OWNER", email: `${unique("dashboard-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

type CircleStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED";
type RoundStatus = "UPCOMING" | "ACTIVE" | "CLOSED";

async function createFixtureCircle(ownerId: string, status: CircleStatus, contributionAmount: string) {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("DashboardTestCircle"),
      currency: "USD",
      contributionAmount,
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
    },
    select: { id: true },
  });
  ownedResourceIds.circleIds.add(circle.id);
  return circle.id;
}

async function createFixtureMember(circleId: string, ownerId: string, displayName: string, payoutOrder: number) {
  return prisma.circleMember.create({
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
}

async function createFixtureRound(
  circleId: string,
  input: { roundNumber: number; recipientId: string; dueDate: Date; status: RoundStatus },
) {
  return prisma.payoutRound.create({
    data: {
      circleId,
      roundNumber: input.roundNumber,
      recipientId: input.recipientId,
      dueDate: input.dueDate,
      status: input.status,
    },
    select: { id: true, dueDate: true },
  });
}

async function createFixtureObligation(
  circleId: string,
  roundId: string,
  memberId: string,
  input: { expectedAmount: string; dueDate: Date },
) {
  return prisma.contributionObligation.create({
    data: {
      circleId,
      roundId,
      memberId,
      expectedAmount: input.expectedAmount,
      currency: "USD",
      dueDate: input.dueDate,
      status: "OPEN",
    },
    select: { id: true },
  });
}

async function createFixturePayment(
  circleId: string,
  obligationId: string,
  recordedById: string,
  input: { amount: string; status: "RECORDED" | "CONFIRMED" | "REJECTED" },
) {
  return prisma.contributionPayment.create({
    data: {
      circleId,
      obligationId,
      amount: input.amount,
      currency: "USD",
      status: input.status,
      clientOperationId: unique("payment"),
      recordedById,
      ...(input.status === "CONFIRMED" ? { confirmedAt: new Date(), confirmedById: recordedById } : {}),
      ...(input.status === "REJECTED" ? { rejectedAt: new Date(), rejectedById: recordedById } : {}),
    },
    select: { id: true },
  });
}

async function createFixturePayout(
  circleId: string,
  roundId: string,
  recordedById: string,
  input: {
    amount: string;
    status: "RECORDED" | "CONFIRMED" | "DISPUTED";
    confirmedByMemberId?: string;
    disputedByMemberId?: string;
  },
) {
  return prisma.payout.create({
    data: {
      circleId,
      roundId,
      amount: input.amount,
      currency: "USD",
      status: input.status,
      clientOperationId: unique("payout"),
      recordedById,
      ...(input.status === "CONFIRMED"
        ? { confirmedAt: new Date(), confirmedByMemberId: input.confirmedByMemberId }
        : {}),
      ...(input.status === "DISPUTED"
        ? { disputedAt: new Date(), disputedByMemberId: input.disputedByMemberId, disputeReason: "Test dispute." }
        : {}),
    },
    select: { id: true },
  });
}

type CircleFixture = {
  ownerId: string;
  circleId: string;
  contributionAmount: string;
  members: Array<{ id: string }>;
  rounds: Array<{ id: string; dueDate: Date }>;
  obligationId: (roundIndex: number, memberIndex: number) => string;
};

/**
 * Builds a circle with `memberCount` members, one PayoutRound per member
 * (member[i] is the recipient of round i+1, exactly mirroring
 * activateCircle's own real topology), and a full member x member grid of
 * ContributionObligation rows -- one per (round, member) pair, matching
 * production exactly. Individual tests layer payments/payouts on top.
 */
async function buildCircleFixture(options: {
  circleStatus: CircleStatus;
  contributionAmount?: string;
  roundStatuses?: RoundStatus[];
  memberCount?: number;
}): Promise<CircleFixture> {
  const ownerId = await createOwner();
  const contributionAmount = options.contributionAmount ?? "100.00";
  const circleId = await createFixtureCircle(ownerId, options.circleStatus, contributionAmount);
  const memberCount = options.memberCount ?? 3;

  const members = [];
  for (let index = 0; index < memberCount; index += 1) {
    members.push(await createFixtureMember(circleId, ownerId, `Fixture Member ${index + 1}`, index + 1));
  }

  const roundStatuses = options.roundStatuses ?? members.map(() => "UPCOMING" as const);
  const rounds = [];
  for (let index = 0; index < members.length; index += 1) {
    rounds.push(
      await createFixtureRound(circleId, {
        roundNumber: index + 1,
        recipientId: members[index].id,
        dueDate: new Date(Date.UTC(2026, 0, 1 + index * 7)),
        status: roundStatuses[index],
      }),
    );
  }

  const obligationIds = new Map<string, string>();
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
      const obligation = await createFixtureObligation(circleId, rounds[roundIndex].id, members[memberIndex].id, {
        expectedAmount: contributionAmount,
        dueDate: rounds[roundIndex].dueDate,
      });
      obligationIds.set(`${roundIndex}-${memberIndex}`, obligation.id);
    }
  }

  return {
    ownerId,
    circleId,
    contributionAmount,
    members,
    rounds,
    obligationId: (roundIndex, memberIndex) => {
      const id = obligationIds.get(`${roundIndex}-${memberIndex}`);
      if (!id) throw new Error(`no fixture obligation for round ${roundIndex}, member ${memberIndex}`);
      return id;
    },
  };
}

function dashboardFor(fixture: CircleFixture, memberIndex: number) {
  return getCircleMemberDashboard({ circleId: fixture.circleId, memberId: fixture.members[memberIndex].id });
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
  // FK-safe order: payments -> payouts -> obligations -> rounds -> members -> circles -> users.
  const circleIds = [...ownedResourceIds.circleIds];
  if (circleIds.length > 0) {
    await prisma.contributionPayment.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.payout.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.contributionObligation.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.payoutRound.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.circleMemberSession.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.circleMember.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.savingsCircle.deleteMany({ where: { id: { in: circleIds } } });
  }
  const userIds = [...ownedResourceIds.userIds];
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

test("A. circle and member summary are populated correctly", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "50.00" });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.circle.id, fixture.circleId);
  assert.equal(result.circle.currency, "USD");
  assert.equal(result.circle.contributionAmount, "50.00");
  assert.equal(result.circle.frequency, "WEEKLY");
  assert.equal(result.circle.status, "ACTIVE");
  assert.equal(result.circle.startDate, "2026-01-01");
  assert.equal(result.member.displayName, "Fixture Member 1");
  assert.equal(result.member.payoutOrder, 1);
});

test("B. the round schedule is deterministic (ordered by roundNumber) and includes recipient names", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE" });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.roundSchedule.length, 3);
  assert.deepEqual(
    result.roundSchedule.map((round) => round.roundNumber),
    [1, 2, 3],
  );
  assert.deepEqual(
    result.roundSchedule.map((round) => round.recipientDisplayName),
    ["Fixture Member 1", "Fixture Member 2", "Fixture Member 3"],
  );
});

test("C. exactly one ACTIVE round is selected as currentRound, not nextRound", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "ACTIVE",
    roundStatuses: ["CLOSED", "ACTIVE", "UPCOMING"],
  });
  const result = await dashboardFor(fixture, 0);

  assert.ok(result.currentRound);
  assert.equal(result.currentRound?.roundNumber, 2);
  assert.equal(result.nextRound, null);
});

test("D. with no ACTIVE round, the lowest non-CLOSED round is offered as nextRound, still labeled UPCOMING", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "ACTIVE",
    roundStatuses: ["UPCOMING", "UPCOMING", "UPCOMING"],
  });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.currentRound, null);
  assert.ok(result.nextRound);
  assert.equal(result.nextRound?.roundNumber, 1);
  // The round's own status is passed through verbatim -- never rewritten
  // to imply it is "currently collecting."
  assert.equal(result.nextRound?.status, "UPCOMING");
});

test("D2. a CLOSED round 1 with UPCOMING round 2 offers round 2 as the lowest non-CLOSED round", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "ACTIVE",
    roundStatuses: ["CLOSED", "UPCOMING", "UPCOMING"],
  });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.nextRound?.roundNumber, 2);
});

test("E. a COMPLETED circle with no ACTIVE round has no next-round framing, but keeps the full historical schedule", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "COMPLETED",
    roundStatuses: ["CLOSED", "CLOSED", "CLOSED"],
  });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.currentRound, null);
  assert.equal(result.nextRound, null);
  assert.equal(result.roundSchedule.length, 3);
});

test("E2. an ARCHIVED circle behaves the same as COMPLETED for round framing", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "ARCHIVED",
    roundStatuses: ["CLOSED", "CLOSED", "CLOSED"],
  });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.currentRound, null);
  assert.equal(result.nextRound, null);
});

test("F. only this member's own obligations are returned, correctly scoped even when amounts differ per member", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  // Give member 2's round-1 obligation a distinctive amount that must never
  // appear in member 1's own obligation list.
  await prisma.contributionObligation.update({
    where: { id: fixture.obligationId(0, 1) },
    data: { expectedAmount: "77.77" },
  });

  const result = await dashboardFor(fixture, 0);

  assert.equal(result.obligations.length, 3, "one obligation per round for this member only");
  for (const obligation of result.obligations) {
    assert.equal(obligation.expectedAmount, "100.00");
  }
});

test("G. a CONFIRMED payment counts as confirmed money", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 0), fixture.ownerId, {
    amount: "100.00",
    status: "CONFIRMED",
  });

  const result = await dashboardFor(fixture, 0);
  const round1 = result.obligations.find((o) => o.roundNumber === 1)!;

  assert.equal(round1.confirmedAmount, "100.00");
  assert.equal(round1.fulfilled, true);
});

test("H. a RECORDED (not yet confirmed) payment does not count as confirmed money", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(1, 0), fixture.ownerId, {
    amount: "100.00",
    status: "RECORDED",
  });

  const result = await dashboardFor(fixture, 0);
  const round2 = result.obligations.find((o) => o.roundNumber === 2)!;

  assert.equal(round2.confirmedAmount, "0.00");
  assert.equal(round2.fulfilled, false);
});

test("I. a REJECTED payment does not count as confirmed money", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(2, 0), fixture.ownerId, {
    amount: "100.00",
    status: "REJECTED",
  });

  const result = await dashboardFor(fixture, 0);
  const round3 = result.obligations.find((o) => o.roundNumber === 3)!;

  assert.equal(round3.confirmedAmount, "0.00");
  assert.equal(round3.fulfilled, false);
});

test("J. multiple prior payment rows against the same obligation are summed to only the CONFIRMED amount", async () => {
  // The schema enforces at most one RECORDED-or-CONFIRMED row per
  // obligation at a time (a partial unique index -- see
  // ContributionPayment_one_unresolved_or_confirmed_per_obligation_idx in
  // the SUSU persistence migration), but REJECTED rows are unlimited
  // historical rows. This exercises the same groupBy/SUM code path with
  // several real rows against one obligation and proves only the CONFIRMED
  // one is ever counted, regardless of how many rejected attempts preceded it.
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  const obligationId = fixture.obligationId(0, 0);
  await createFixturePayment(fixture.circleId, obligationId, fixture.ownerId, { amount: "999.00", status: "REJECTED" });
  await createFixturePayment(fixture.circleId, obligationId, fixture.ownerId, { amount: "500.00", status: "REJECTED" });
  await createFixturePayment(fixture.circleId, obligationId, fixture.ownerId, { amount: "100.00", status: "CONFIRMED" });

  const result = await dashboardFor(fixture, 0);
  const round1 = result.obligations.find((o) => o.roundNumber === 1)!;

  assert.equal(round1.confirmedAmount, "100.00");
  assert.equal(round1.fulfilled, true);
});

test("K. outstanding amount is computed with exact Decimal arithmetic, not floating point", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "33.33" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 0), fixture.ownerId, {
    amount: "11.11",
    status: "CONFIRMED",
  });

  const result = await dashboardFor(fixture, 0);
  const round1 = result.obligations.find((o) => o.roundNumber === 1)!;

  assert.equal(round1.outstandingAmount, "22.22");
});

test("L. an overpayment clamps outstandingAmount to zero, never negative", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "50.00" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 0), fixture.ownerId, {
    amount: "75.00",
    status: "CONFIRMED",
  });

  const result = await dashboardFor(fixture, 0);
  const round1 = result.obligations.find((o) => o.roundNumber === 1)!;

  assert.equal(round1.outstandingAmount, "0.00");
  assert.equal(round1.fulfilled, true);
});

test("M. fulfilled is derived from the payment ledger, not from the stale ContributionObligation.status column", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  // Manually mark the obligation FULFILLED in the database with NO
  // confirmed payment behind it -- the read model must not trust this.
  await prisma.contributionObligation.update({
    where: { id: fixture.obligationId(0, 0) },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });

  const result = await dashboardFor(fixture, 0);
  const round1 = result.obligations.find((o) => o.roundNumber === 1)!;

  assert.equal(round1.fulfilled, false, "must be false: no CONFIRMED payment exists, regardless of obligation.status");
});

test("N. confirmedContributionTotal and fulfilled/total obligation counts are correct across multiple rounds", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "100.00" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 0), fixture.ownerId, { amount: "100.00", status: "CONFIRMED" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(1, 0), fixture.ownerId, { amount: "60.00", status: "CONFIRMED" });
  // round 3 obligation left fully unpaid.

  const result = await dashboardFor(fixture, 0);

  assert.equal(result.summary.confirmedContributionTotal, "160.00");
  assert.equal(result.summary.fulfilledObligationCount, 1);
  assert.equal(result.summary.totalObligationCount, 3);
});

test("O. circle-wide round progress is an aggregate count only, computed from the ledger", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "ACTIVE",
    contributionAmount: "100.00",
    roundStatuses: ["ACTIVE", "UPCOMING", "UPCOMING"],
  });
  // Round 1 (the selected/current round): member 1 and member 2 fully
  // confirmed, member 3 not paid at all.
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 0), fixture.ownerId, { amount: "100.00", status: "CONFIRMED" });
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 1), fixture.ownerId, { amount: "100.00", status: "CONFIRMED" });

  const result = await dashboardFor(fixture, 0);

  assert.deepEqual(result.roundProgress, { confirmedMemberCount: 2, totalMemberCount: 3 });
  assert.deepEqual(Object.keys(result.roundProgress!).sort(), ["confirmedMemberCount", "totalMemberCount"]);
});

test("P. another member's specific financial figures never appear anywhere in this member's dashboard", async () => {
  const fixture = await buildCircleFixture({
    circleStatus: "ACTIVE",
    contributionAmount: "100.00",
    roundStatuses: ["ACTIVE", "UPCOMING", "UPCOMING"],
  });
  // A distinctive, never-reused amount tied only to member 2.
  await createFixturePayment(fixture.circleId, fixture.obligationId(0, 1), fixture.ownerId, { amount: "913.42", status: "CONFIRMED" });

  const result = await dashboardFor(fixture, 0);
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /913\.42/);
});

test("Q. no Payout row yet is represented as null, not a zero-amount row", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE" });
  const result = await dashboardFor(fixture, 0);

  assert.equal(result.payout, null);
});

test("R. a RECORDED payout is never treated as recipient-confirmed receipt", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "300.00" });
  await createFixturePayout(fixture.circleId, fixture.rounds[0].id, fixture.ownerId, {
    amount: "300.00",
    status: "RECORDED",
  });

  const result = await dashboardFor(fixture, 0);

  assert.ok(result.payout);
  assert.equal(result.payout?.status, "RECORDED");
  assert.equal(result.payout?.confirmedAt, null);
  // The result carries no derived "received"/"confirmed" boolean that could
  // be misread as receipt -- only the raw status string and timestamps.
  assert.deepEqual(Object.keys(result.payout!).sort(), ["amount", "confirmedAt", "disputedAt", "recordedAt", "roundNumber", "status"]);
});

test("S. a CONFIRMED payout is represented truthfully with its confirmedAt timestamp", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "300.00" });
  await createFixturePayout(fixture.circleId, fixture.rounds[0].id, fixture.ownerId, {
    amount: "300.00",
    status: "CONFIRMED",
    confirmedByMemberId: fixture.members[0].id,
  });

  const result = await dashboardFor(fixture, 0);

  assert.equal(result.payout?.status, "CONFIRMED");
  assert.ok(result.payout?.confirmedAt);
  assert.equal(result.payout?.disputedAt, null);
});

test("T. a DISPUTED payout is represented truthfully with its disputedAt timestamp", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE", contributionAmount: "300.00" });
  await createFixturePayout(fixture.circleId, fixture.rounds[0].id, fixture.ownerId, {
    amount: "300.00",
    status: "DISPUTED",
    disputedByMemberId: fixture.members[0].id,
  });

  const result = await dashboardFor(fixture, 0);

  assert.equal(result.payout?.status, "DISPUTED");
  assert.ok(result.payout?.disputedAt);
  assert.equal(result.payout?.confirmedAt, null);
});

test("U. a cross-circle mismatch (real member, wrong circleId) is rejected as member-not-found", async () => {
  const fixtureA = await buildCircleFixture({ circleStatus: "ACTIVE" });
  const fixtureB = await buildCircleFixture({ circleStatus: "ACTIVE" });

  await assert.rejects(
    () => getCircleMemberDashboard({ circleId: fixtureB.circleId, memberId: fixtureA.members[0].id }),
    CircleMemberDashboardMemberNotFoundError,
  );
});

test("U2. a nonexistent circleId is rejected as circle-not-found", async () => {
  await assert.rejects(
    () => getCircleMemberDashboard({ circleId: "cnonexistentcircleidxxxxxx", memberId: "cnonexistentmemberidxxxxx" }),
    CircleMemberDashboardCircleNotFoundError,
  );
});

test("U3. a DRAFT circle is rejected as not eligible", async () => {
  const owner = await createOwner();
  const circleId = await createFixtureCircle(owner, "DRAFT", "100.00");
  const member = await createFixtureMember(circleId, owner, "Draft Member", 1);

  await assert.rejects(
    () => getCircleMemberDashboard({ circleId, memberId: member.id }),
    CircleMemberDashboardCircleNotEligibleError,
  );
});

test("U4. a REMOVED member is rejected as not active", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE" });
  await prisma.circleMember.update({ where: { id: fixture.members[0].id }, data: { status: "REMOVED" } });

  await assert.rejects(() => dashboardFor(fixture, 0), CircleMemberDashboardMemberNotActiveError);
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("V. no pinHash, memberCode, email, credential, or session fields are ever returned or selected", async () => {
  const repositoryPath = fileURLToPath(new URL("../repositories/circle-member-dashboard.repository.ts", import.meta.url));
  const servicePath = fileURLToPath(new URL("./circle-member-dashboard.service.ts", import.meta.url));
  const repositoryCode = stripComments(readFileSync(repositoryPath, "utf8"));
  const serviceCode = stripComments(readFileSync(servicePath, "utf8"));

  for (const forbidden of [
    "pinHash",
    "memberCode",
    "email",
    "failedPinAttempts",
    "lockedUntil",
    "credentialVersion",
    "tokenHash",
    "addedById",
    "removedById",
  ]) {
    assert.ok(!repositoryCode.includes(forbidden), `repository must not select "${forbidden}"`);
    assert.ok(!serviceCode.includes(forbidden), `service must not reference "${forbidden}"`);
  }

  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE" });
  const result = await dashboardFor(fixture, 0);
  const serialized = JSON.stringify(result);

  for (const forbidden of ["pinHash", "memberCode", "credentialVersion", "tokenHash", "failedPinAttempts", "lockedUntil"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("V2. the service never reads cookies or imports next/headers, next-auth, or @/auth", () => {
  const servicePath = fileURLToPath(new URL("./circle-member-dashboard.service.ts", import.meta.url));
  const code = stripComments(readFileSync(servicePath, "utf8"));
  for (const forbidden of ["next/headers", "next-auth", "@/auth", "cookies("]) {
    assert.ok(!code.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("W. the dashboard read performs no domain mutation, including against its own fixture tables", async () => {
  const fixture = await buildCircleFixture({ circleStatus: "ACTIVE" });

  const before = {
    rounds: await prisma.payoutRound.count({ where: { circleId: fixture.circleId } }),
    obligations: await prisma.contributionObligation.count({ where: { circleId: fixture.circleId } }),
    payments: await prisma.contributionPayment.count({ where: { circleId: fixture.circleId } }),
    payouts: await prisma.payout.count({ where: { circleId: fixture.circleId } }),
    members: await prisma.circleMember.count({ where: { circleId: fixture.circleId } }),
  };

  await dashboardFor(fixture, 0);
  await dashboardFor(fixture, 1);
  await dashboardFor(fixture, 2);

  const after = {
    rounds: await prisma.payoutRound.count({ where: { circleId: fixture.circleId } }),
    obligations: await prisma.contributionObligation.count({ where: { circleId: fixture.circleId } }),
    payments: await prisma.contributionPayment.count({ where: { circleId: fixture.circleId } }),
    payouts: await prisma.payout.count({ where: { circleId: fixture.circleId } }),
    members: await prisma.circleMember.count({ where: { circleId: fixture.circleId } }),
  };

  assert.deepEqual(after, before);
});

test("W2. this suite makes no financial/domain lifecycle mutation outside the SUSU tables it created", async () => {
  const finalCounts = {
    users: (await prisma.user.count()) - ownedResourceIds.userIds.size,
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});
