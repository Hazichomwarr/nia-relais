import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export const DRAFT_CIRCLE_CURRENCIES = ["USD", "XOF", "EUR", "GBP"] as const;
export const DRAFT_CIRCLE_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export const CIRCLE_ORIGIN_KINDS = ["NEW", "IMPORTED"] as const;

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

const circleTermsSchema = z
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
  });

function enforceNewCircleStartDate(value: { startDate: string }, context: z.RefinementCtx) {
    if (value.startDate < todayUtcDateOnly()) {
      context.addIssue({ code: "custom", path: ["startDate"], message: "Start date cannot be in the past." });
    }
}

// Creation and normal-DRAFT configuration editing intentionally share the
// same terms contract. This is the NEW-only path: byte-for-byte unchanged
// by 9D.1 -- a NEW circle must not accept a historical start date merely
// because import support now exists (9D.1 §3).
export const createDraftCircleSchema = circleTermsSchema.superRefine(enforceNewCircleStartDate);
export const updateDraftCircleConfigurationSchema = circleTermsSchema.superRefine(enforceNewCircleStartDate);

export type CreateDraftCircleInput = z.input<typeof createDraftCircleSchema>;
export type UpdateDraftCircleConfigurationInput = z.input<typeof updateDraftCircleConfigurationSchema>;

// The IMPORTED-only path (9D.1, docs/product/susu-existing-import-contract-freeze.md
// §2/§4). Same terms contract, but: (1) no past-date floor on startDate --
// this is the SUSU's true original start date, the authoritative schedule
// anchor for future reconstruction (9E), never inferred from elapsed time;
// (2) historicalCompletedRoundCount ("K") is required and must be a whole
// number >= 1 -- K=0 is deliberately rejected here (freeze §2's "zero and
// completed-circle edges" table: K=0 is not an import, it must use the
// normal NEW path) so the canonical NEW/IMPORTED distinction is never
// blurred by an imported circle with no actual history; (3) the owner must
// explicitly confirm the completed rounds used the same contribution
// amount/currency as the terms entered here -- validation-only (the freeze
// records no field for it; see circle.service.ts), never persisted.
//
// 9D.1 deliberately does NOT enforce K < N here (the ticket's own
// instruction): the authoritative active-member count is not known at
// validation time. 9E's activation reconstruction enforces 1 <= K < N.
const HISTORICAL_COMPLETED_ROUND_COUNT_PATTERN = /^\d+$/;

function enforceImportedCircleFields(
  value: { historicalCompletedRoundCount: string; historicalTermsConfirmed?: string },
  context: z.RefinementCtx,
) {
  if (!HISTORICAL_COMPLETED_ROUND_COUNT_PATTERN.test(value.historicalCompletedRoundCount)) {
    context.addIssue({
      code: "custom",
      path: ["historicalCompletedRoundCount"],
      message: "Enter a whole number of completed rounds.",
    });
  } else if (Number(value.historicalCompletedRoundCount) === 0) {
    context.addIssue({
      code: "custom",
      path: ["historicalCompletedRoundCount"],
      message: "Enter at least 1 completed round, or choose \"Starting a new SUSU\" if none are complete yet.",
    });
  }

  if (value.historicalTermsConfirmed !== "on") {
    context.addIssue({
      code: "custom",
      path: ["historicalTermsConfirmed"],
      message: "Confirm that the completed rounds used this same contribution amount and currency.",
    });
  }
}

const importedCircleFieldsSchema = z.object({
  historicalCompletedRoundCount: z.string().trim(),
  historicalTermsConfirmed: z.string().trim().optional(),
});

export const createImportedDraftCircleSchema = circleTermsSchema
  .extend(importedCircleFieldsSchema.shape)
  .superRefine(enforceImportedCircleFields);

// Same rules as creation -- an IMPORTED DRAFT's original start date, K, and
// term-consistency acknowledgement remain editable, with identical
// validation, for as long as the circle stays DRAFT (freeze §3).
export const updateImportedDraftCircleConfigurationSchema = createImportedDraftCircleSchema;

export type CreateImportedDraftCircleInput = z.input<typeof createImportedDraftCircleSchema>;
export type UpdateImportedDraftCircleConfigurationInput = z.input<typeof updateImportedDraftCircleConfigurationSchema>;

const optionalEmail = z
  .union([z.string().trim().email("Enter a valid email."), z.literal("")])
  .transform((value) => value ? value.toLowerCase() : undefined);

const optionalPhone = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .refine(
    (value) => value === undefined || (value.length >= 7 && value.length <= 32 && /^(?=(?:\D*\d){7,15}\D*$)[+\d][\d\s().-]*$/.test(value)),
    "Enter a valid phone number.",
  );

export const addDraftCircleMemberSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a member name.").max(100, "Member name must be 100 characters or fewer."),
  phone: optionalPhone.optional(),
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
