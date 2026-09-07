import { Prisma } from "@prisma/client";

import { createPersonalGoalRecord } from "@/src/repositories/goal.repository";
import type { CreatePersonalGoalInput } from "@/src/validations/goal.schema";

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

export async function createPersonalGoal(
  user: { id: string },
  input: CreatePersonalGoalInput,
) {
  const today = todayUtcDateOnly();

  if (!user.id) throw new InvalidPersonalGoalError("A platform User is required.");
  if (!input.name.trim()) throw new InvalidPersonalGoalError("Goal name is required.");
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new InvalidPersonalGoalError("Currency must be a three-letter uppercase code.");
  }
  if (input.startDate > today) {
    throw new InvalidPersonalGoalError("Start date cannot be in the future.");
  }
  if (input.unlockDate <= input.startDate) {
    throw new InvalidPersonalGoalError("Unlock date must be after the start date.");
  }
  if (input.unlockDate < today) {
    throw new InvalidPersonalGoalError("Unlock date cannot be in the past.");
  }

  return createPersonalGoalRecord({
    ownerId: user.id,
    name: input.name,
    currency: input.currency,
    targetAmount: toMoney(input.targetAmount, "Target amount"),
    weeklyAmount: toMoney(input.weeklyAmount, "Weekly amount"),
    startDate: toUtcDate(input.startDate),
    unlockDate: toUtcDate(input.unlockDate),
  });
}
