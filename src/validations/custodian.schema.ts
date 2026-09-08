import { z } from "zod";

const APPLICATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const assignmentId = z
  .string()
  .trim()
  .min(1, "An assignment is required.")
  .max(100, "The assignment identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The assignment identifier is invalid.");

export const createCustodianAssignmentSchema = z.object({
  goalId: z
    .string()
    .trim()
    .min(1, "A goal is required.")
    .max(100, "The goal identifier is invalid.")
    .regex(APPLICATION_ID_PATTERN, "The goal identifier is invalid."),
  custodianEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Enter a valid email address.")
    .email("Enter a valid email address."),
});

export const decideCustodianAssignmentSchema = z.object({
  assignmentId,
});

export type CreateCustodianAssignmentInput = z.infer<typeof createCustodianAssignmentSchema>;
export type DecideCustodianAssignmentInput = z.infer<typeof decideCustodianAssignmentSchema>;
