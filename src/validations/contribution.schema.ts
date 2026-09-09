import { z } from "zod";

// Input shapes for the future recordContributionPayment /
// confirmContributionPayment / rejectContributionPayment services (7J.2+).
// No service exists yet -- these schemas exist so the eventual Server
// Action wrappers have a validated, safely-typed input to hand a service,
// exactly mirroring custodian-deposit.schema.ts's depositId/rejectionReason
// pattern and deposit.schema.ts's money/clientOperationId pattern.
//
// Deliberately absent from every schema below: ownerId, status, any actor
// ID, any timestamp, currency, and expectedAmount. Ownership and identity
// come only from requireUser() at the Server Action boundary (never from
// form input); the frozen expectedAmount is read fresh from the
// ContributionObligation row itself, under the circle-row lock, by the
// future service -- see amountMatchesObligation in
// src/domain/contribution-accounting.ts. Client-side validation passing is
// never treated as authoritative; the future service re-validates the
// amount's Decimal shape again defensively before use, exactly as
// deposit.service.ts's own toMoney(value: string) already does for
// deposits.

const APPLICATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

const obligationId = z
  .string()
  .trim()
  .min(1, "A contribution obligation is required.")
  .max(100, "The obligation identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The obligation identifier is invalid.");

const paymentId = z
  .string()
  .trim()
  .min(1, "A contribution payment is required.")
  .max(100, "The payment identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The payment identifier is invalid.");

const money = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, "Use an amount with up to two decimal places.")
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return whole.length <= 16 && !/^0*$/.test(whole + fraction);
  }, "Amount must be greater than zero and fit DECIMAL(18,2).");

const clientOperationId = z
  .string()
  .trim()
  .min(1, "An operation identifier is required.")
  .max(200, "Operation identifier must be 200 characters or fewer.");

const rejectionReason = z
  .string()
  .trim()
  .min(1, "Enter a rejection reason.")
  .max(500, "Rejection reason must be 500 characters or fewer.");

export const recordContributionSchema = z.object({
  obligationId,
  amount: money,
  clientOperationId,
});

export const confirmContributionSchema = z.object({
  paymentId,
});

export const rejectContributionSchema = z.object({
  paymentId,
  rejectionReason,
});

export type RecordContributionInput = z.infer<typeof recordContributionSchema>;
export type ConfirmContributionInput = z.infer<typeof confirmContributionSchema>;
export type RejectContributionInput = z.infer<typeof rejectContributionSchema>;
