import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
import { checkIsolatedTestDatabaseConfiguration } from "@/src/testing/isolated-test-database";
import { getFounderMetrics } from "./founder-metrics.service";

const founder = { id: "caaaaaaaaaaaaaaaaaaaaaaaa", name: "Founder" };
const referenceTime = new Date("2026-10-31T12:00:00.000Z");

function repository(overrides: Partial<{
  totalRegisteredUsers: number;
  newUsersLast24Hours: number;
  newUsersLast7Days: number;
  newUsersLast30Days: number;
  personalSavingsUsers: number;
  susuCircleOwners: number;
  personalOnlyUsers: number;
  susuOnlyUsers: number;
  bothProductUsers: number;
  neitherProductUsers: number;
  activeProductUsers: number;
  personalSavingsSetupUsers: number;
  personalSavingsActivatedOwners: number;
  susuSetupOwners: number;
  susuOperationallyActivatedOwners: number;
  activePlatformActorsLast7Days: number;
  activePlatformActorsLast30Days: number;
}> = {}) {
  return {
    loadSummary: async (receivedReferenceTime: Date) => {
      assert.equal(receivedReferenceTime.toISOString(), referenceTime.toISOString());
      return {
        totalRegisteredUsers: 10,
        newUsersLast24Hours: 2,
        newUsersLast7Days: 4,
        newUsersLast30Days: 7,
        personalSavingsUsers: 4,
        susuCircleOwners: 3,
        personalOnlyUsers: 1,
        susuOnlyUsers: 0,
        bothProductUsers: 3,
        neitherProductUsers: 6,
        activeProductUsers: 5,
        personalSavingsSetupUsers: 4,
        personalSavingsActivatedOwners: 3,
        susuSetupOwners: 2,
        susuOperationallyActivatedOwners: 1,
        activePlatformActorsLast7Days: 2,
        activePlatformActorsLast30Days: 5,
        ...overrides,
      };
    },
    loadRegistrationGrowth: async (receivedReferenceTime: Date) => {
      assert.equal(receivedReferenceTime.toISOString(), referenceTime.toISOString());
      return [
        { date: "2026-10-02", registrations: 0 },
        { date: "2026-10-03", registrations: 2 },
      ];
    },
  };
}

test("founder metrics uses one UTC reference time and aggregates only safe counts", async () => {
  const metrics = await getFounderMetrics({
    requireSuperAdmin: async () => founder,
    repository: repository(),
    now: () => referenceTime,
  });

  assert.deepEqual(metrics, {
    generatedAt: "2026-10-31T12:00:00.000Z",
    totalRegisteredUsers: 10,
    registrations: { last24Hours: 2, last7Days: 4, last30Days: 7 },
    personalSavings: { users: 4, adoptionPercent: 40 },
    susu: { owners: 3, adoptionPercent: 30 },
    productBreakdown: { personalOnly: 1, susuOnly: 0, both: 3, neither: 6 },
    activeProductUsersLast30Days: 5,
    analytics: {
      personalSavingsSetupUsers: 4,
      personalSavingsActivatedOwners: 3,
      susuSetupOwners: 2,
      susuOperationallyActivatedOwners: 1,
      activePlatformActorsLast7Days: 2,
      activePlatformActorsLast30Days: 5,
    },
    registrationGrowth: [
      { date: "2026-10-02", registrations: 0 },
      { date: "2026-10-03", registrations: 2 },
    ],
  });
});

test("an empty database has an empty, reconciling product-adoption breakdown", async () => {
  const metrics = await getFounderMetrics({
    requireSuperAdmin: async () => founder,
    repository: repository({
      totalRegisteredUsers: 0,
      personalSavingsUsers: 0,
      susuCircleOwners: 0,
      personalOnlyUsers: 0,
      susuOnlyUsers: 0,
      bothProductUsers: 0,
      neitherProductUsers: 0,
      activeProductUsers: 0,
      personalSavingsSetupUsers: 0,
      personalSavingsActivatedOwners: 0,
      susuSetupOwners: 0,
      susuOperationallyActivatedOwners: 0,
      activePlatformActorsLast7Days: 0,
      activePlatformActorsLast30Days: 0,
    }),
    now: () => referenceTime,
  });

  assert.equal(metrics.personalSavings.adoptionPercent, 0);
  assert.equal(metrics.susu.adoptionPercent, 0);
  assert.deepEqual(metrics.productBreakdown, { personalOnly: 0, susuOnly: 0, both: 0, neither: 0 });
});

test("the exclusive categories reconcile to registered users and existing ownership totals", async () => {
  const metrics = await getFounderMetrics({
    requireSuperAdmin: async () => founder,
    repository: repository({
      totalRegisteredUsers: 9,
      personalSavingsUsers: 5,
      susuCircleOwners: 4,
      personalOnlyUsers: 2,
      susuOnlyUsers: 1,
      bothProductUsers: 3,
      neitherProductUsers: 3,
    }),
    now: () => referenceTime,
  });

  const { personalOnly, susuOnly, both, neither } = metrics.productBreakdown;
  assert.equal(personalOnly + susuOnly + both + neither, metrics.totalRegisteredUsers);
  assert.equal(personalOnly + both, metrics.personalSavings.users);
  assert.equal(susuOnly + both, metrics.susu.owners);
});

test("an inconsistent repository breakdown is rejected instead of being displayed", async () => {
  await assert.rejects(() => getFounderMetrics({
    requireSuperAdmin: async () => founder,
    repository: repository({ personalOnlyUsers: 2, susuOnlyUsers: 0, bothProductUsers: 3, neitherProductUsers: 6 }),
    now: () => referenceTime,
  }), /inconsistent product-adoption breakdown/);
});

test("the metrics loader independently authorizes before it executes database reads", async () => {
  let queried = false;
  await assert.rejects(() => getFounderMetrics({
    requireSuperAdmin: async () => { throw new Error("not authorized"); },
    repository: {
      loadSummary: async () => { queried = true; throw new Error("should not run"); },
      loadRegistrationGrowth: async () => { queried = true; return []; },
    },
    now: () => referenceTime,
  }));
  assert.equal(queried, false);
});

test("database failures are propagated rather than presented as fabricated zeros", async () => {
  await assert.rejects(() => getFounderMetrics({
    requireSuperAdmin: async () => founder,
    repository: {
      loadSummary: async () => { throw new Error("database unavailable"); },
      loadRegistrationGrowth: async () => [],
    },
    now: () => referenceTime,
  }), /database unavailable/);
});

const repositorySource = readFileSync(new URL("../repositories/founder-metrics.repository.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../../app/(app)/admin/founder-metrics-dashboard.tsx", import.meta.url), "utf8");

test("the dashboard has typed concise EN/FR labels for each exclusive category", () => {
  assert.deepEqual(
    [en.admin.personalSavingsOnly, en.admin.susuOnly, en.admin.bothProducts, en.admin.neitherProduct],
    ["Personal Savings only", "SUSU only", "Both products", "Neither product"],
  );
  assert.deepEqual(
    [fr.admin.personalSavingsOnly, fr.admin.susuOnly, fr.admin.bothProducts, fr.admin.neitherProduct],
    ["Épargne personnelle uniquement", "SUSU uniquement", "Les deux produits", "Aucun des deux produits"],
  );
  assert.match(dashboardSource, /metrics\.productBreakdown\.personalOnly/);
  assert.match(dashboardSource, /metrics\.productBreakdown\.susuOnly/);
  assert.match(dashboardSource, /metrics\.productBreakdown\.both/);
  assert.match(dashboardSource, /metrics\.productBreakdown\.neither/);
});

test("the dashboard has typed EN/FR labels for setup, activation, and actor activity", () => {
  assert.deepEqual(
    [
      en.admin.personalSavingsSetup,
      en.admin.personalSavingsActivation,
      en.admin.susuSetup,
      en.admin.susuOperationalActivation,
      en.admin.activePlatformActors,
    ],
    ["Personal Savings setup", "Personal Savings activation", "SUSU setup", "SUSU operational activation", "Active platform actors"],
  );
  assert.deepEqual(
    [
      fr.admin.personalSavingsSetup,
      fr.admin.personalSavingsActivation,
      fr.admin.susuSetup,
      fr.admin.susuOperationalActivation,
      fr.admin.activePlatformActors,
    ],
    ["Configuration de l’épargne personnelle", "Activation de l’épargne personnelle", "Configuration SUSU", "Activation opérationnelle SUSU", "Acteurs actifs sur la plateforme"],
  );
  assert.match(dashboardSource, /metrics\.analytics\.personalSavingsSetupUsers/);
  assert.match(dashboardSource, /metrics\.analytics\.personalSavingsActivatedOwners/);
  assert.match(dashboardSource, /metrics\.analytics\.susuSetupOwners/);
  assert.match(dashboardSource, /metrics\.analytics\.susuOperationallyActivatedOwners/);
  assert.match(dashboardSource, /metrics\.analytics\.activePlatformActorsLast7Days/);
  assert.match(dashboardSource, /metrics\.analytics\.activePlatformActorsLast30Days/);
});

test("aggregate SQL separates setup from activation and uses only durable actor provenance", () => {
  assert.match(repositorySource, /legacy_product_actions AS \(\s+SELECT "recordedById" AS "actorId"\s+FROM "Deposit"\s+WHERE "createdAt" >= \$\{last30Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /FROM "ContributionPayment"\s+WHERE "createdAt" >= \$\{last30Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /FROM "Payout"\s+WHERE "createdAt" >= \$\{last30Days\}\s+AND "createdAt" < \$\{referenceTime\}\s+AND "confirmationBasis" = 'MEMBER_CONFIRMED'::"PayoutConfirmationBasis"/);
  assert.match(repositorySource, /COUNT\(DISTINCT "actorId"\) FROM legacy_product_actions/);
  assert.match(repositorySource, /"createdAt" >= \$\{last24Hours\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"createdAt" >= \$\{last7Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"createdAt" >= \$\{last30Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /goal_owners AS \(\s+SELECT DISTINCT "ownerId"\s+FROM "PersonalGoal"/);
  assert.match(repositorySource, /circle_owners AS \(\s+SELECT DISTINCT "ownerId"\s+FROM "SavingsCircle"/);
  assert.match(repositorySource, /"hasPersonalSavings" AND NOT "hasSusu"/);
  assert.match(repositorySource, /NOT "hasPersonalSavings" AND "hasSusu"/);
  assert.match(repositorySource, /"hasPersonalSavings" AND "hasSusu"/);
  assert.match(repositorySource, /NOT "hasPersonalSavings" AND NOT "hasSusu"/);
  assert.match(repositorySource, /WHERE "originKind" = 'NEW'::"CircleOriginKind"/);
  assert.match(repositorySource, /personal_savings_activated_owners AS/);
  assert.match(repositorySource, /"Deposit"\."status" = 'APPROVED'::"DepositStatus"/);
  assert.match(repositorySource, /SELECT DISTINCT "PersonalGoal"\."ownerId"/);
  assert.match(repositorySource, /susu_operationally_activated_owners AS/);
  assert.match(repositorySource, /"PayoutRound"\."closureBasis" = 'NIA_MANAGED'::"RoundClosureBasis"/);
  assert.match(repositorySource, /SELECT "approvedById" AS "actorId", "approvedAt" AS "occurredAt"/);
  assert.match(repositorySource, /SELECT "rejectedById" AS "actorId", "rejectedAt" AS "occurredAt"/);
  assert.match(repositorySource, /SELECT "confirmedById" AS "actorId", "confirmedAt" AS "occurredAt"/);
  assert.match(repositorySource, /SELECT "activatedById" AS "actorId", "activatedAt" AS "occurredAt"/);
  assert.match(repositorySource, /"occurredAt" >= \$\{last7Days\} AND "occurredAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"occurredAt" >= \$\{last30Days\} AND "occurredAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /COUNT\(DISTINCT "actorId"\)/);
  assert.doesNotMatch(repositorySource, /CircleMemberSession/);
  assert.doesNotMatch(repositorySource, /confirmedByMemberId" AS "actorId/);
  assert.doesNotMatch(repositorySource, /depositDate/);
  assert.doesNotMatch(repositorySource, /updatedAt/);
  assert.match(repositorySource, /'MEMBER_CONFIRMED'::"PayoutConfirmationBasis"/);
  assert.match(repositorySource, /AT TIME ZONE 'UTC'/);
  assert.match(repositorySource, /INTERVAL '29 days'/);
  assert.match(repositorySource, /ORDER BY days\."day" ASC/);
});

test("the repository preserves legacy recording activity while separately counting decision and live-round actors", async (context) => {
  const isolatedDatabase = checkIsolatedTestDatabaseConfiguration();
  if (!isolatedDatabase.isolated) {
    context.skip(isolatedDatabase.reason);
    return;
  }

  const [{ prisma }, { founderMetricsRepository }] = await Promise.all([
    import("@/src/prisma"),
    import("@/src/repositories/founder-metrics.repository"),
  ]);
  const fixtureId = randomUUID();
  const referenceTime = new Date("2026-10-31T12:00:00.000Z");
  const withinSevenDays = new Date("2026-10-29T12:00:00.000Z");
  const exactlyThirtyDaysEarlier = new Date("2026-10-01T12:00:00.000Z");
  const userIds: string[] = [];
  const goalIds: string[] = [];
  let circleId: string | null = null;

  const createUser = async (name: string) => {
    const user = await prisma.user.create({
      data: { name, email: `${fixtureId}-${name}@example.invalid` },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  };

  try {
    const ownerId = await createUser("analytics-owner");
    const legacyActorId = await createUser("analytics-legacy-actor");
    const boundaryActorId = await createUser("analytics-boundary-actor");
    const decisionActorId = await createUser("analytics-decision-actor");
    const roundActorId = await createUser("analytics-round-actor");
    const excludedEndActorId = await createUser("analytics-end-boundary-actor");
    const goal = await prisma.personalGoal.create({
      data: {
        ownerId,
        name: `Analytics goal ${fixtureId}`,
        currency: "USD",
        targetAmount: "100.00",
        weeklyAmount: "10.00",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        unlockDate: new Date("2026-03-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    goalIds.push(goal.id);
    const custodian = await prisma.goalCustodian.create({
      data: {
        goalId: goal.id,
        userId: decisionActorId,
        displayName: "Analytics custodian",
        status: "ACTIVE",
        assignedById: ownerId,
      },
      select: { id: true },
    });

    await prisma.deposit.createMany({
      data: [
        {
          goalId: goal.id,
          amount: "1.00",
          depositDate: withinSevenDays,
          recordedById: legacyActorId,
          verificationMode: "OWNER",
          clientOperationId: randomUUID(),
          status: "PENDING",
          createdAt: withinSevenDays,
        },
        {
          goalId: goal.id,
          amount: "2.00",
          depositDate: withinSevenDays,
          recordedById: legacyActorId,
          verificationMode: "OWNER",
          clientOperationId: randomUUID(),
          status: "PENDING",
          createdAt: withinSevenDays,
        },
        {
          goalId: goal.id,
          amount: "3.00",
          depositDate: exactlyThirtyDaysEarlier,
          recordedById: boundaryActorId,
          verificationMode: "OWNER",
          clientOperationId: randomUUID(),
          status: "PENDING",
          createdAt: exactlyThirtyDaysEarlier,
        },
        {
          goalId: goal.id,
          amount: "4.00",
          depositDate: withinSevenDays,
          recordedById: ownerId,
          verificationMode: "CUSTODIAN",
          responsibleCustodianId: custodian.id,
          clientOperationId: randomUUID(),
          status: "APPROVED",
          approvedAt: withinSevenDays,
          approvedById: decisionActorId,
          createdAt: new Date("2026-08-01T12:00:00.000Z"),
        },
        {
          goalId: goal.id,
          amount: "5.00",
          depositDate: referenceTime,
          recordedById: excludedEndActorId,
          verificationMode: "OWNER",
          clientOperationId: randomUUID(),
          status: "PENDING",
          createdAt: referenceTime,
        },
      ],
    });

    const circle = await prisma.savingsCircle.create({
      data: {
        ownerId,
        circleCode: `ANA-${fixtureId.slice(0, 8).toUpperCase()}`,
        name: `Analytics circle ${fixtureId}`,
        currency: "USD",
        contributionAmount: "10.00",
        frequency: "MONTHLY",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    circleId = circle.id;
    const member = await prisma.circleMember.create({
      data: {
        circleId: circle.id,
        displayName: "Analytics member",
        memberCode: `MEM-${fixtureId.slice(0, 8).toUpperCase()}`,
        pinHash: "not-a-real-pin-hash",
        addedById: ownerId,
        payoutOrder: 1,
      },
      select: { id: true },
    });
    await prisma.payoutRound.create({
      data: {
        circleId: circle.id,
        roundNumber: 1,
        dueDate: withinSevenDays,
        recipientId: member.id,
        status: "ACTIVE",
        activatedAt: withinSevenDays,
        activatedById: roundActorId,
      },
    });

    const summary = await founderMetricsRepository.loadSummary(referenceTime);
    assert.equal(summary.activeProductUsers, 2, "legacy activity includes recording actors once and includes the start boundary");
    assert.equal(summary.activePlatformActorsLast30Days, 4, "decision-only and live-round actors belong only to the new actor metric");
    assert.equal(summary.activePlatformActorsLast7Days, 3, "the thirty-day start-boundary actor is outside the seven-day window");
  } finally {
    if (circleId) {
      await prisma.payoutRound.deleteMany({ where: { circleId } });
      await prisma.circleMember.deleteMany({ where: { circleId } });
      await prisma.savingsCircle.deleteMany({ where: { id: circleId } });
    }
    if (goalIds.length > 0) {
      await prisma.deposit.deleteMany({ where: { goalId: { in: goalIds } } });
      await prisma.goalCustodian.deleteMany({ where: { goalId: { in: goalIds } } });
      await prisma.personalGoal.deleteMany({ where: { id: { in: goalIds } } });
    }
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
