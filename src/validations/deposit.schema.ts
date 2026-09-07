import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

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
  .refine(isValidDateOnly, "Use a valid calendar date.")
  .refine((value) => value <= todayUtcDateOnly(), "Deposit date cannot be in the future.");

const money = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, "Use an amount with up to two decimal places.")
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return whole.length <= 16 && !/^0*$/.test(whole + fraction);
  }, "Amount must be greater than zero and fit DECIMAL(18,2).");

export const createDepositSchema = z.object({
  goalId: z.string().trim().min(1, "A goal is required."),
  amount: money,
  depositDate: dateOnly,
  note: z
    .string()
    .trim()
    .max(500, "Note must be 500 characters or fewer.")
    .transform((value) => value || null)
    .optional(),
  clientOperationId: z
    .string()
    .trim()
    .min(1, "An operation identifier is required.")
    .max(200, "Operation identifier must be 200 characters or fewer."),
});

export type CreateDepositInput = z.infer<typeof createDepositSchema>;
