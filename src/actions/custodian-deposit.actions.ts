"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/src/auth/require-user";
import {
  CustodianDepositDecisionConflictError,
  CustodianDepositDecisionNotFoundError,
  InvalidCustodianDepositRejectionReasonError,
  approveCustodianDeposit,
  rejectCustodianDeposit,
  type CustodianDepositDecisionResult,
} from "@/src/services/custodian-deposit-decision.service";
import {
  approveCustodianDepositSchema,
  rejectCustodianDepositSchema,
} from "@/src/validations/custodian-deposit.schema";

type ActionOutcome = "success" | "error";

export type ApproveCustodianDepositActionState = {
  status?: ActionOutcome;
  fieldErrors?: Partial<Record<"depositId", string[]>>;
  decision?: CustodianDepositDecisionResult;
  formError?: string;
};

export type RejectCustodianDepositActionState = {
  status?: ActionOutcome;
  fieldErrors?: Partial<Record<"depositId" | "rejectionReason", string[]>>;
  decision?: CustodianDepositDecisionResult;
  formError?: string;
};

function revalidateDecisionPaths(goalId: string) {
  revalidatePath("/custodian");
  revalidatePath("/dashboard");
  revalidatePath(`/goals/${encodeURIComponent(goalId)}/deposits`);
}

export async function approveCustodianDepositAction(
  _previousState: ApproveCustodianDepositActionState,
  formData: FormData,
): Promise<ApproveCustodianDepositActionState> {
  const parsed = approveCustodianDepositSchema.safeParse({
    depositId: formData.get("depositId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const decision = await approveCustodianDeposit(parsed.data.depositId, user.id);
    revalidateDecisionPaths(decision.goalId);
    return { status: "success", decision };
  } catch (error) {
    if (error instanceof CustodianDepositDecisionNotFoundError) {
      return { status: "error", formError: "We could not update this Deposit." };
    }

    if (error instanceof CustodianDepositDecisionConflictError) {
      return { status: "error", formError: error.message };
    }

    console.error(
      "[approveCustodianDepositAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not update this Deposit. Please try again." };
  }
}

export async function rejectCustodianDepositAction(
  _previousState: RejectCustodianDepositActionState,
  formData: FormData,
): Promise<RejectCustodianDepositActionState> {
  const parsed = rejectCustodianDepositSchema.safeParse({
    depositId: formData.get("depositId"),
    rejectionReason: formData.get("rejectionReason"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const decision = await rejectCustodianDeposit(
      parsed.data.depositId,
      user.id,
      parsed.data.rejectionReason,
    );
    revalidateDecisionPaths(decision.goalId);
    return { status: "success", decision };
  } catch (error) {
    if (error instanceof InvalidCustodianDepositRejectionReasonError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof CustodianDepositDecisionNotFoundError) {
      return { status: "error", formError: "We could not update this Deposit." };
    }

    if (error instanceof CustodianDepositDecisionConflictError) {
      return { status: "error", formError: error.message };
    }

    console.error(
      "[rejectCustodianDepositAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not update this Deposit. Please try again." };
  }
}
