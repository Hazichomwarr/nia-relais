import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export const PERSONAL_GOAL_CURRENCIES = ["USD", "XOF", "EUR", "GBP"] as const;

function isValidDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function todayUtcDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

const dateOnly = z
  .string()
  .trim()
  .regex(DATE_ONLY_PATTERN, "Use a valid date.")
  .refine(isValidDateOnly, "Use a valid calendar date.");

const money = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, "Use an amount with up to two decimal places.")
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return whole.length <= 16 && !/^0*$/.test(whole + fraction);
  }, "Amount must be greater than zero and fit DECIMAL(18,2).");

export const createPersonalGoalSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a goal name.").max(100, "Goal name must be 100 characters or fewer."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (value) => PERSONAL_GOAL_CURRENCIES.includes(value as (typeof PERSONAL_GOAL_CURRENCIES)[number]),
        "Choose USD, XOF, EUR, or GBP.",
      ),
    targetAmount: money,
    weeklyAmount: money,
    startDate: dateOnly,
  })
  .superRefine((value, context) => {
    const today = todayUtcDateOnly();

    if (value.startDate > today) {
      context.addIssue({ code: "custom", path: ["startDate"], message: "Start date cannot be in the future." });
    }

  });

export type CreatePersonalGoalInput = z.infer<typeof createPersonalGoalSchema>;
