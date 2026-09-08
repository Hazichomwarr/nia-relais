"use server";

import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import {
  GoalNotAvailableForDepositsError,
  InvalidDepositError,
  MultipleActiveCustodiansError,
  createDeposit,
} from "@/src/services/deposit.service";
import { createDepositSchema } from "@/src/validations/deposit.schema";

export type CreateDepositActionState = {
  fieldErrors?: Partial<Record<"amount" | "depositDate" | "note" | "clientOperationId", string[]>>;
  formError?: string;
  success?: {
    status: "PENDING" | "APPROVED";
    amount: string;
  };
};

function isNextRedirectError(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;

  const digest = error.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function createDepositAction(
  _previousState: CreateDepositActionState,
  formData: FormData,
): Promise<CreateDepositActionState> {
  const parsed = createDepositSchema.safeParse({
    goalId: formData.get("goalId"),
    amount: formData.get("amount"),
    depositDate: formData.get("depositDate"),
    note: formData.get("note"),
    clientOperationId: formData.get("clientOperationId"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    return {
      fieldErrors: {
        amount: fieldErrors.amount,
        depositDate: fieldErrors.depositDate,
        note: fieldErrors.note,
        clientOperationId: fieldErrors.clientOperationId,
      },
    };
  }

  try {
    const created = await createDeposit(parsed.data);

    if (created.status !== "PENDING" && created.status !== "APPROVED") {
      return { formError: "We could not confirm the recording status. Please try again." };
    }

    return {
      success: {
        status: created.status,
        amount: created.amount,
      },
    };
  } catch (error) {
    if (isNextRedirectError(error)) throw error;

    if (error instanceof InvalidDepositError) {
      return { formError: error.message };
    }

    if (error instanceof GoalNotAvailableForDepositsError) {
      return { formError: "This goal is not available for deposits." };
    }

    if (error instanceof MultipleActiveCustodiansError) {
      return { formError: "We could not record this deposit because the goal needs attention." };
    }

    if (error instanceof GoalNotFoundOrUnauthorizedError) {
      return { formError: "We could not record this deposit." };
    }

    console.error(
      "[createDepositAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not record this deposit. Please try again." };
  }
}
