import { Prisma } from "@prisma/client";

import {
  createPersonalGoalRecord,
  findPersonalGoalsByOwnerId,
} from "@/src/repositories/goal.repository";
import { sumApprovedDepositAmountsByGoalIds } from "@/src/repositories/deposit.repository";
import {
  PERSONAL_GOAL_CURRENCIES,
  type CreatePersonalGoalInput,
} from "@/src/validations/goal.schema";

export class InvalidPersonalGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPersonalGoalError";
  }
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function todayUtcDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function toMoney(value: string, fieldName: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new InvalidPersonalGoalError(`${fieldName} must have no more than two decimal places.`);
  }

  const [whole] = value.split(".");
  if (whole.length > 16) {
    throw new InvalidPersonalGoalError(`${fieldName} must fit DECIMAL(18,2).`);
  }

  const amount = new Prisma.Decimal(value);
  if (!amount.gt(0)) {
    throw new InvalidPersonalGoalError(`${fieldName} must be greater than zero.`);
  }

  return amount;
}

export function calculateGoalUnlockDate(input: {
  targetAmount: Prisma.Decimal;
  weeklyAmount: Prisma.Decimal;
  startDate: Date;
}) {
  if (!input.targetAmount.gt(0) || !input.weeklyAmount.gt(0)) {
    throw new InvalidPersonalGoalError("Goal amounts must be greater than zero.");
  }

  const weeksNeeded = input.targetAmount.div(input.weeklyAmount).ceil();
  const milliseconds = BigInt(7 * 24 * 60 * 60 * 1000);
  const timestamp = BigInt(input.startDate.getTime()) + BigInt(weeksNeeded.toFixed(0)) * milliseconds;
  const maximumDateMilliseconds = BigInt(8640000000000000);

  if (timestamp > maximumDateMilliseconds || timestamp < -maximumDateMilliseconds) {
    throw new InvalidPersonalGoalError("Goal timeline is too far in the future.");
  }

  return new Date(Number(timestamp));
}

export async function createPersonalGoal(
  user: { id: string },
  input: CreatePersonalGoalInput,
) {
  const today = todayUtcDateOnly();

  if (!user.id) throw new InvalidPersonalGoalError("A platform User is required.");
  if (!input.name.trim()) throw new InvalidPersonalGoalError("Goal name is required.");
  if (!PERSONAL_GOAL_CURRENCIES.includes(input.currency as (typeof PERSONAL_GOAL_CURRENCIES)[number])) {
    throw new InvalidPersonalGoalError("Choose USD, XOF, EUR, or GBP.");
  }
  if (input.startDate > today) {
    throw new InvalidPersonalGoalError("Start date cannot be in the future.");
  }
  const targetAmount = toMoney(input.targetAmount, "Target amount");
  const weeklyAmount = toMoney(input.weeklyAmount, "Weekly amount");
  const startDate = toUtcDate(input.startDate);

  return createPersonalGoalRecord({
    ownerId: user.id,
    name: input.name,
    currency: input.currency,
    targetAmount,
    weeklyAmount,
    startDate,
    unlockDate: calculateGoalUnlockDate({ targetAmount, weeklyAmount, startDate }),
  });
}

export type PersonalGoalDashboardSummary = {
  id: string;
  name: string;
  currency: string;
  targetAmount: string;
  weeklyAmount: string;
  startDate: string;
  unlockDate: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  savedAmount: string;
  remainingAmount: string;
  progressPercent: number;
};

function serializeDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function statusRank(status: PersonalGoalDashboardSummary["status"]) {
  return status === "ACTIVE" ? 0 : status === "COMPLETED" ? 1 : 2;
}

export async function getPersonalGoalsForDashboard(user: { id: string }) {
  const goals = await findPersonalGoalsByOwnerId(user.id);
  const approvedTotals = await sumApprovedDepositAmountsByGoalIds(goals.map((goal) => goal.id));
  const approvedTotalsByGoalId = new Map(
    approvedTotals.map((total) => [total.goalId, total._sum.amount ?? new Prisma.Decimal(0)]),
  );

  return [...goals]
    .sort((left, right) => {
      const statusDifference = statusRank(left.status) - statusRank(right.status);
      if (statusDifference !== 0) return statusDifference;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })
    .map<PersonalGoalDashboardSummary>((goal) => ({
      id: goal.id,
      name: goal.name,
      currency: goal.currency,
      targetAmount: goal.targetAmount.toFixed(2),
      weeklyAmount: goal.weeklyAmount.toFixed(2),
      startDate: goal.startDate.toISOString().slice(0, 10),
      unlockDate: goal.unlockDate.toISOString().slice(0, 10),
      status: goal.status,
      completedAt: serializeDate(goal.completedAt),
      archivedAt: serializeDate(goal.archivedAt),
      createdAt: goal.createdAt.toISOString(),
      savedAmount: (approvedTotalsByGoalId.get(goal.id) ?? new Prisma.Decimal(0)).toFixed(2),
      remainingAmount: (() => {
        const savedAmount = approvedTotalsByGoalId.get(goal.id) ?? new Prisma.Decimal(0);
        const remainingAmount = goal.targetAmount.minus(savedAmount);
        return (remainingAmount.gt(0) ? remainingAmount : new Prisma.Decimal(0)).toFixed(2);
      })(),
      progressPercent: (() => {
        const savedAmount = approvedTotalsByGoalId.get(goal.id) ?? new Prisma.Decimal(0);
        return savedAmount.div(goal.targetAmount).mul(100).toNumber();
      })(),
    }));
}
