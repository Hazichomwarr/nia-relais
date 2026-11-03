import "server-only";

import { requireSuperAdmin, type VerifiedPlatformUser } from "@/src/auth/require-super-admin";
import {
  founderMetricsRepository,
  type FounderMetricsRepository,
} from "@/src/repositories/founder-metrics.repository";

export type FounderMetricPoint = { readonly date: string; readonly registrations: number };

export type FounderMetrics = {
  readonly generatedAt: string;
  readonly totalRegisteredUsers: number;
  readonly registrations: {
    readonly last24Hours: number;
    readonly last7Days: number;
    readonly last30Days: number;
  };
  readonly personalSavings: { readonly users: number; readonly adoptionPercent: number };
  readonly susu: { readonly owners: number; readonly adoptionPercent: number };
  readonly productBreakdown: {
    readonly personalOnly: number;
    readonly susuOnly: number;
    readonly both: number;
    readonly neither: number;
  };
  readonly activeProductUsersLast30Days: number;
  readonly analytics: {
    readonly personalSavingsSetupUsers: number;
    readonly personalSavingsActivatedOwners: number;
    readonly susuSetupOwners: number;
    readonly susuOperationallyActivatedOwners: number;
    readonly activePlatformActorsLast7Days: number;
    readonly activePlatformActorsLast30Days: number;
  };
  readonly registrationGrowth: readonly FounderMetricPoint[];
};

type Dependencies = {
  readonly requireSuperAdmin: () => Promise<VerifiedPlatformUser>;
  readonly repository: FounderMetricsRepository;
  readonly now: () => Date;
};

const defaults: Dependencies = {
  requireSuperAdmin,
  repository: founderMetricsRepository,
  now: () => new Date(),
};

function asCount(value: number | bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Founder metrics received an invalid aggregate count");
  return count;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

function assertProductBreakdown(
  totalRegisteredUsers: number,
  personalSavingsUsers: number,
  susuCircleOwners: number,
  breakdown: FounderMetrics["productBreakdown"],
) {
  const { personalOnly, susuOnly, both, neither } = breakdown;
  if (
    personalOnly + susuOnly + both + neither !== totalRegisteredUsers
    || personalOnly + both !== personalSavingsUsers
    || susuOnly + both !== susuCircleOwners
  ) {
    throw new Error("Founder metrics received an inconsistent product-adoption breakdown");
  }
}

/**
 * Founder-only aggregate read model. Authorization is deliberately repeated
 * here so future callers cannot depend on the /admin page as their boundary.
 */
export async function getFounderMetrics(
  dependencies: Partial<Dependencies> = {},
): Promise<FounderMetrics> {
  const deps = { ...defaults, ...dependencies };
  await deps.requireSuperAdmin();

  const referenceTime = deps.now();
  const [summary, growth] = await Promise.all([
    deps.repository.loadSummary(referenceTime),
    deps.repository.loadRegistrationGrowth(referenceTime),
  ]);

  const totalRegisteredUsers = asCount(summary.totalRegisteredUsers);
  const personalSavingsUsers = asCount(summary.personalSavingsUsers);
  const susuCircleOwners = asCount(summary.susuCircleOwners);
  const productBreakdown = {
    personalOnly: asCount(summary.personalOnlyUsers),
    susuOnly: asCount(summary.susuOnlyUsers),
    both: asCount(summary.bothProductUsers),
    neither: asCount(summary.neitherProductUsers),
  };
  assertProductBreakdown(totalRegisteredUsers, personalSavingsUsers, susuCircleOwners, productBreakdown);

  return {
    generatedAt: referenceTime.toISOString(),
    totalRegisteredUsers,
    registrations: {
      last24Hours: asCount(summary.newUsersLast24Hours),
      last7Days: asCount(summary.newUsersLast7Days),
      last30Days: asCount(summary.newUsersLast30Days),
    },
    personalSavings: {
      users: personalSavingsUsers,
      adoptionPercent: percent(personalSavingsUsers, totalRegisteredUsers),
    },
    susu: {
      owners: susuCircleOwners,
      adoptionPercent: percent(susuCircleOwners, totalRegisteredUsers),
    },
    productBreakdown,
    activeProductUsersLast30Days: asCount(summary.activeProductUsers),
    analytics: {
      personalSavingsSetupUsers: asCount(summary.personalSavingsSetupUsers),
      personalSavingsActivatedOwners: asCount(summary.personalSavingsActivatedOwners),
      susuSetupOwners: asCount(summary.susuSetupOwners),
      susuOperationallyActivatedOwners: asCount(summary.susuOperationallyActivatedOwners),
      activePlatformActorsLast7Days: asCount(summary.activePlatformActorsLast7Days),
      activePlatformActorsLast30Days: asCount(summary.activePlatformActorsLast30Days),
    },
    registrationGrowth: growth.map((point) => ({
      date: point.date,
      registrations: asCount(point.registrations),
    })),
  };
}
