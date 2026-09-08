import { z } from "zod";

const APPLICATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const depositId = z
  .string()
  .trim()
  .min(1, "A Deposit is required.")
  .max(100, "The Deposit identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The Deposit identifier is invalid.");

export const approveCustodianDepositSchema = z.object({
  depositId,
});

export const rejectCustodianDepositSchema = z.object({
  depositId,
  rejectionReason: z
    .string()
    .trim()
    .min(1, "Enter a rejection reason.")
    .max(500, "Rejection reason must be 500 characters or fewer."),
});

export type ApproveCustodianDepositInput = z.infer<typeof approveCustodianDepositSchema>;
export type RejectCustodianDepositInput = z.infer<typeof rejectCustodianDepositSchema>;
