import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
    activeProductUsersLast30Days: 5,
    registrationGrowth: [
      { date: "2026-10-02", registrations: 0 },
      { date: "2026-10-03", registrations: 2 },
    ],
  });
});

test("adoption percentages safely remain zero when no platform users exist", async () => {
  const metrics = await getFounderMetrics({
    requireSuperAdmin: async () => founder,
    repository: repository({ totalRegisteredUsers: 0, personalSavingsUsers: 0, susuCircleOwners: 0, activeProductUsers: 0 }),
    now: () => referenceTime,
  });

  assert.equal(metrics.personalSavings.adoptionPercent, 0);
  assert.equal(metrics.susu.adoptionPercent, 0);
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

test("aggregate SQL uses half-open rolling windows, UTC daily series, distinct owners, and excludes imported payouts", () => {
  assert.match(repositorySource, /"createdAt" >= \$\{last24Hours\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"createdAt" >= \$\{last7Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /"createdAt" >= \$\{last30Days\} AND "createdAt" < \$\{referenceTime\}/);
  assert.match(repositorySource, /COUNT\(DISTINCT "ownerId"\) FROM "PersonalGoal"/);
  assert.match(repositorySource, /COUNT\(DISTINCT "ownerId"\) FROM "SavingsCircle"/);
  assert.match(repositorySource, /'MEMBER_CONFIRMED'::"PayoutConfirmationBasis"/);
  assert.match(repositorySource, /AT TIME ZONE 'UTC'/);
  assert.match(repositorySource, /INTERVAL '29 days'/);
  assert.match(repositorySource, /ORDER BY days\."day" ASC/);
});
