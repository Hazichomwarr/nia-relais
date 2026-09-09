import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export const DRAFT_CIRCLE_CURRENCIES = ["USD", "XOF", "EUR", "GBP"] as const;
export const DRAFT_CIRCLE_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;

function isValidDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
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

export const createDraftCircleSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a circle name.").max(100, "Circle name must be 100 characters or fewer."),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (value) => DRAFT_CIRCLE_CURRENCIES.includes(value as (typeof DRAFT_CIRCLE_CURRENCIES)[number]),
        "Choose USD, XOF, EUR, or GBP.",
      ),
    contributionAmount: money,
    frequency: z.enum(DRAFT_CIRCLE_FREQUENCIES, "Choose a supported contribution frequency."),
    startDate: dateOnly,
  })
  .superRefine((value, context) => {
    if (value.startDate < todayUtcDateOnly()) {
      context.addIssue({ code: "custom", path: ["startDate"], message: "Start date cannot be in the past." });
    }
  });

export type CreateDraftCircleInput = z.input<typeof createDraftCircleSchema>;

const optionalEmail = z
  .union([z.string().trim().email("Enter a valid email."), z.literal("")])
  .transform((value) => value ? value.toLowerCase() : undefined);

export const addDraftCircleMemberSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a member name.").max(100, "Member name must be 100 characters or fewer."),
  email: optionalEmail.optional(),
  pin: z.string().regex(/^\d{6}$/, "Use a six-digit PIN."),
});

export type AddDraftCircleMemberInput = z.input<typeof addDraftCircleMemberSchema>;

export const setDraftCirclePayoutOrderSchema = z.object({
  orderedMemberIds: z
    .array(z.string().trim().min(1, "Use valid circle member IDs."))
    .min(1, "Add at least one active member before setting a payout order.")
    .superRefine((memberIds, context) => {
      if (new Set(memberIds).size !== memberIds.length) {
        context.addIssue({ code: "custom", message: "Each circle member can appear only once." });
      }
    }),
});

export type SetDraftCirclePayoutOrderInput = z.input<typeof setDraftCirclePayoutOrderSchema>;
