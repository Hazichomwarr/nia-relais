"use server";

import { revalidatePath } from "next/cache";

import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import { requireUser } from "@/src/auth/require-user";
import {
  ActiveCustodianConflictError,
  CustodianAssignmentAlreadyOpenError,
  CustodianAssignmentAuthorizationError,
  CustodianAssignmentDecisionConflictError,
  CustodianAssignmentEndAuthorizationError,
  CustodianAssignmentEndConflictError,
  CustodianAssignmentCancellationAuthorizationError,
  CustodianAssignmentCancellationConflictError,
  CustodianAssignmentNotFoundError,
  EligibleCustodianNotFoundError,
  GoalNotAvailableForCustodianAcceptanceError,
  GoalNotAvailableForCustodianAssignmentError,
  SelfCustodianAssignmentError,
  acceptCustodianAssignment,
  createCustodianAssignment,
  declineCustodianAssignment,
  cancelCustodianAssignmentRequest,
  endCustodianAssignment,
  type CustodianAssignmentResult,
  type CustodianDecisionResult,
  type EndedCustodianAssignmentResult,
  type CancelledCustodianAssignmentResult,
} from "@/src/services/custodian.service";
import {
  createCustodianAssignmentSchema,
  decideCustodianAssignmentSchema,
} from "@/src/validations/custodian.schema";

type ActionOutcome = "success" | "error";

export type CreateCustodianAssignmentActionState = {
  status?: ActionOutcome;
  fieldErrors?: Partial<Record<"goalId" | "custodianEmail", string[]>>;
  assignment?: CustodianAssignmentResult;
  formError?: string;
};

export type CustodianDecisionActionState = {
  status?: ActionOutcome;
  fieldErrors?: Partial<Record<"assignmentId", string[]>>;
  assignment?: CustodianDecisionResult;
  formError?: string;
};

export type EndCustodianAssignmentActionState = {
  status?: ActionOutcome;
  fieldErrors?: Partial<Record<"assignmentId", string[]>>;
  assignment?: EndedCustodianAssignmentResult;
  formError?: string;
};

export type CancelCustodianAssignmentActionState = {
  status?: ActionOutcome;
  fieldErrors?: Partial<Record<"assignmentId", string[]>>;
  assignment?: CancelledCustodianAssignmentResult;
  formError?: string;
};

function isNextRedirectError(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;

  const digest = error.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function createCustodianAssignmentAction(
  _previousState: CreateCustodianAssignmentActionState,
  formData: FormData,
): Promise<CreateCustodianAssignmentActionState> {
  const parsed = createCustodianAssignmentSchema.safeParse({
    goalId: formData.get("goalId"),
    custodianEmail: formData.get("custodianEmail"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const assignment = await createCustodianAssignment(user, parsed.data);
    revalidatePath("/dashboard");
    return { status: "success", assignment };
  } catch (error) {
    if (isNextRedirectError(error)) throw error;

    if (error instanceof EligibleCustodianNotFoundError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof SelfCustodianAssignmentError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof GoalNotAvailableForCustodianAssignmentError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof CustodianAssignmentAlreadyOpenError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof GoalNotFoundOrUnauthorizedError) {
      return { status: "error", formError: "We could not assign a custodian for this goal." };
    }

    console.error(
      "[createCustodianAssignmentAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not assign a custodian. Please try again." };
  }
}

export async function acceptCustodianAssignmentAction(
  _previousState: CustodianDecisionActionState,
  formData: FormData,
): Promise<CustodianDecisionActionState> {
  return decideCustodianAssignmentAction(formData, acceptCustodianAssignment);
}

export async function declineCustodianAssignmentAction(
  _previousState: CustodianDecisionActionState,
  formData: FormData,
): Promise<CustodianDecisionActionState> {
  return decideCustodianAssignmentAction(formData, declineCustodianAssignment);
}

export async function endCustodianAssignmentAction(
  _previousState: EndCustodianAssignmentActionState,
  formData: FormData,
): Promise<EndCustodianAssignmentActionState> {
  const parsed = decideCustodianAssignmentSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const assignment = await endCustodianAssignment(parsed.data.assignmentId, user.id);
    revalidatePath("/dashboard");
    revalidatePath("/custodian");
    return { status: "success", assignment };
  } catch (error) {
    if (isNextRedirectError(error)) throw error;

    if (error instanceof CustodianAssignmentEndAuthorizationError) {
      return { status: "error", formError: "You are not authorized to end this assignment." };
    }

    if (error instanceof CustodianAssignmentNotFoundError) {
      return { status: "error", formError: "We could not update that assignment." };
    }

    if (error instanceof CustodianAssignmentEndConflictError) {
      return { status: "error", formError: "This assignment cannot be ended in its current state." };
    }

    console.error(
      "[endCustodianAssignmentAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not end that assignment. Please try again." };
  }
}

export async function cancelCustodianAssignmentRequestAction(
  _previousState: CancelCustodianAssignmentActionState,
  formData: FormData,
): Promise<CancelCustodianAssignmentActionState> {
  const parsed = decideCustodianAssignmentSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const assignment = await cancelCustodianAssignmentRequest(user.id, parsed.data.assignmentId);
    revalidatePath("/dashboard");
    revalidatePath("/custodian");
    return { status: "success", assignment };
  } catch (error) {
    if (isNextRedirectError(error)) throw error;

    if (error instanceof CustodianAssignmentCancellationAuthorizationError) {
      return { status: "error", formError: "You are not authorized to cancel this request." };
    }

    if (error instanceof CustodianAssignmentNotFoundError) {
      return { status: "error", formError: "We could not update that request." };
    }

    if (error instanceof CustodianAssignmentCancellationConflictError) {
      return { status: "error", formError: "This request can no longer be cancelled." };
    }

    console.error(
      "[cancelCustodianAssignmentRequestAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not cancel that request. Please try again." };
  }
}

async function decideCustodianAssignmentAction(
  formData: FormData,
  decide: (assignmentId: string, authenticatedUserId: string) => Promise<CustodianDecisionResult>,
): Promise<CustodianDecisionActionState> {
  const parsed = decideCustodianAssignmentSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const assignment = await decide(parsed.data.assignmentId, user.id);
    revalidatePath("/dashboard");
    revalidatePath("/custodian");
    return { status: "success", assignment };
  } catch (error) {
    if (isNextRedirectError(error)) throw error;

    if (error instanceof CustodianAssignmentAuthorizationError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof CustodianAssignmentNotFoundError) {
      return { status: "error", formError: "We could not update that assignment." };
    }

    if (error instanceof GoalNotAvailableForCustodianAcceptanceError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof ActiveCustodianConflictError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof CustodianAssignmentDecisionConflictError) {
      return { status: "error", formError: error.message };
    }

    console.error(
      "[custodianDecisionAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not update that assignment. Please try again." };
  }
}
