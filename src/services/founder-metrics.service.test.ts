import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
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

test("aggregate SQL uses half-open rolling windows, UTC daily series, distinct ownership, and excludes imported payouts", () => {
  assert.match(repositorySource, /"createdAt" >= \$\{last24Hours\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"createdAt" >= \$\{last7Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"createdAt" >= \$\{last30Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /goal_owners AS \(\s+SELECT DISTINCT "ownerId"\s+FROM "PersonalGoal"/);
  assert.match(repositorySource, /circle_owners AS \(\s+SELECT DISTINCT "ownerId"\s+FROM "SavingsCircle"/);
  assert.match(repositorySource, /"hasPersonalSavings" AND NOT "hasSusu"/);
  assert.match(repositorySource, /NOT "hasPersonalSavings" AND "hasSusu"/);
  assert.match(repositorySource, /"hasPersonalSavings" AND "hasSusu"/);
  assert.match(repositorySource, /NOT "hasPersonalSavings" AND NOT "hasSusu"/);
  assert.doesNotMatch(repositorySource, /CircleMember/);
  assert.match(repositorySource, /'MEMBER_CONFIRMED'::"PayoutConfirmationBasis"/);
  assert.match(repositorySource, /AT TIME ZONE 'UTC'/);
  assert.match(repositorySource, /INTERVAL '29 days'/);
  assert.match(repositorySource, /ORDER BY days\."day" ASC/);
});
