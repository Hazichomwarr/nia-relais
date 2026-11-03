import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

export type FounderMetricsSummaryRecord = {
  readonly totalRegisteredUsers: number | bigint;
  readonly newUsersLast24Hours: number | bigint;
  readonly newUsersLast7Days: number | bigint;
  readonly newUsersLast30Days: number | bigint;
  readonly personalSavingsUsers: number | bigint;
  readonly susuCircleOwners: number | bigint;
  readonly personalOnlyUsers: number | bigint;
  readonly susuOnlyUsers: number | bigint;
  readonly bothProductUsers: number | bigint;
  readonly neitherProductUsers: number | bigint;
  readonly activeProductUsers: number | bigint;
};

export type FounderRegistrationGrowthRecord = {
  readonly date: string;
  readonly registrations: number | bigint;
};

export type FounderMetricsRepository = {
  loadSummary(referenceTime: Date): Promise<FounderMetricsSummaryRecord>;
  loadRegistrationGrowth(referenceTime: Date): Promise<readonly FounderRegistrationGrowthRecord[]>;
};

function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error("Founder metrics query returned no aggregate row");
  return row;
}

export const founderMetricsRepository: FounderMetricsRepository = {
  async loadSummary(referenceTime) {
    const last24Hours = new Date(referenceTime.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(referenceTime.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(referenceTime.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await prisma.$queryRaw<FounderMetricsSummaryRecord[]>(Prisma.sql`
      WITH product_actions AS (
        SELECT "recordedById" AS "actorId"
        FROM "Deposit"
        WHERE "createdAt" >= ${last30Days} AND "createdAt" < ${referenceTime}

        UNION

        SELECT "recordedById" AS "actorId"
        FROM "ContributionPayment"
        WHERE "createdAt" >= ${last30Days} AND "createdAt" < ${referenceTime}

        UNION

        SELECT "recordedById" AS "actorId"
        FROM "Payout"
        WHERE "createdAt" >= ${last30Days}
          AND "createdAt" < ${referenceTime}
          AND "confirmationBasis" = 'MEMBER_CONFIRMED'::"PayoutConfirmationBasis"
      ),
      goal_owners AS (
        SELECT DISTINCT "ownerId"
        FROM "PersonalGoal"
      ),
      circle_owners AS (
        SELECT DISTINCT "ownerId"
        FROM "SavingsCircle"
      ),
      user_product_ownership AS (
        SELECT
          "User"."id",
          goal_owners."ownerId" IS NOT NULL AS "hasPersonalSavings",
          circle_owners."ownerId" IS NOT NULL AS "hasSusu"
        FROM "User"
        LEFT JOIN goal_owners ON goal_owners."ownerId" = "User"."id"
        LEFT JOIN circle_owners ON circle_owners."ownerId" = "User"."id"
      )
      SELECT
        (SELECT COUNT(*) FROM user_product_ownership) AS "totalRegisteredUsers",
        (SELECT COUNT(*) FROM "User" WHERE "createdAt" >= ${last24Hours} AND "createdAt" < ${referenceTime}) AS "newUsersLast24Hours",
        (SELECT COUNT(*) FROM "User" WHERE "createdAt" >= ${last7Days} AND "createdAt" < ${referenceTime}) AS "newUsersLast7Days",
        (SELECT COUNT(*) FROM "User" WHERE "createdAt" >= ${last30Days} AND "createdAt" < ${referenceTime}) AS "newUsersLast30Days",
        (SELECT COUNT(*) FROM user_product_ownership WHERE "hasPersonalSavings") AS "personalSavingsUsers",
        (SELECT COUNT(*) FROM user_product_ownership WHERE "hasSusu") AS "susuCircleOwners",
        (SELECT COUNT(*) FROM user_product_ownership WHERE "hasPersonalSavings" AND NOT "hasSusu") AS "personalOnlyUsers",
        (SELECT COUNT(*) FROM user_product_ownership WHERE NOT "hasPersonalSavings" AND "hasSusu") AS "susuOnlyUsers",
        (SELECT COUNT(*) FROM user_product_ownership WHERE "hasPersonalSavings" AND "hasSusu") AS "bothProductUsers",
        (SELECT COUNT(*) FROM user_product_ownership WHERE NOT "hasPersonalSavings" AND NOT "hasSusu") AS "neitherProductUsers",
        (SELECT COUNT(DISTINCT "actorId") FROM product_actions) AS "activeProductUsers"
    `);

    return firstRow(rows);
  },

  async loadRegistrationGrowth(referenceTime) {
    return prisma.$queryRaw<FounderRegistrationGrowthRecord[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', ${referenceTime}::timestamptz AT TIME ZONE 'UTC') - INTERVAL '29 days',
          date_trunc('day', ${referenceTime}::timestamptz AT TIME ZONE 'UTC'),
          INTERVAL '1 day'
        ) AS "day"
      )
      SELECT
        to_char(days."day", 'YYYY-MM-DD') AS "date",
        COUNT("User"."id") AS "registrations"
      FROM days
      LEFT JOIN "User"
        ON "User"."createdAt" >= days."day" AT TIME ZONE 'UTC'
        AND "User"."createdAt" < (days."day" + INTERVAL '1 day') AT TIME ZONE 'UTC'
      GROUP BY days."day"
      ORDER BY days."day" ASC
    `);
  },
};
