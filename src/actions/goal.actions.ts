"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { GoalNotFoundOrUnauthorizedError } from "@/src/auth/require-goal-owner";
import { requireUser } from "@/src/auth/require-user";
import {
  PersonalGoalArchiveConflictError,
  PersonalGoalArchivePendingDepositsError,
  archivePersonalGoal,
  type PersonalGoalArchiveResult,
} from "@/src/services/goal-archive.service";
import {
  PersonalGoalCompletionConflictError,
  PersonalGoalCompletionNotEligibleError,
  completePersonalGoal,
  type PersonalGoalCompletionResult,
} from "@/src/services/goal-completion.service";
import {
  createPersonalGoal,
  InvalidPersonalGoalError,
} from "@/src/services/goal.service";
import {
  createCustodianAssignment,
  EligibleCustodianNotFoundError,
  SelfCustodianAssignmentError,
} from "@/src/services/custodian.service";
import {
  archivePersonalGoalSchema,
  completePersonalGoalSchema,
  createPersonalGoalSchema,
} from "@/src/validations/goal.schema";
import { createCustodianAssignmentSchema } from "@/src/validations/custodian.schema";
import { abandonPersonalGoal, PersonalGoalAbandonmentConflictError } from "@/src/services/goal-abandonment.service";
import { abandonPersonalGoalSchema } from "@/src/validations/goal.schema";

export type CreatePersonalGoalActionState = {
  fieldErrors?: Partial<
    Record<
      "name" | "currency" | "targetAmount" | "weeklyAmount" | "startDate",
      string[]
    >
  >;
  formError?: string;
  createdGoalId?: string;
  custodianAssignment?: "created" | "unavailable";
};

export type CompletePersonalGoalActionState = {
  status?: "success" | "error";
  fieldErrors?: Partial<Record<"goalId", string[]>>;
  completion?: PersonalGoalCompletionResult;
  formError?: string;
};

export type ArchivePersonalGoalActionState = {
  status?: "success" | "error";
  fieldErrors?: Partial<Record<"goalId", string[]>>;
  archive?: PersonalGoalArchiveResult;
  formError?: string;
};

export type AbandonPersonalGoalActionState = { status?: "success" | "error"; formError?: string };

export async function abandonPersonalGoalAction(
  _previousState: AbandonPersonalGoalActionState,
  formData: FormData,
): Promise<AbandonPersonalGoalActionState> {
  const parsed = abandonPersonalGoalSchema.safeParse({ goalId: formData.get("goalId") });
  if (!parsed.success) return { status: "error", formError: "We could not abandon this goal." };
  const user = await requireUser();
  try {
    await abandonPersonalGoal({ ownerId: user.id, goalId: parsed.data.goalId });
    revalidatePath("/dashboard"); revalidatePath("/deposits"); revalidatePath(`/goals/${encodeURIComponent(parsed.data.goalId)}/deposits`);
    return { status: "success" };
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError || error instanceof PersonalGoalAbandonmentConflictError) return { status: "error", formError: "We could not abandon this goal." };
    console.error("[abandonPersonalGoalAction] unexpected failure", error instanceof Error ? error.name : "UnknownError");
    return { status: "error", formError: "We could not abandon this goal." };
  }
}

export async function createPersonalGoalAction(
  _previousState: CreatePersonalGoalActionState,
  formData: FormData,
): Promise<CreatePersonalGoalActionState> {
  const parsed = createPersonalGoalSchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency"),
    targetAmount: formData.get("targetAmount"),
    weeklyAmount: formData.get("weeklyAmount"),
    startDate: formData.get("startDate"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const user = await requireUser();

  try {
    const goal = await createPersonalGoal(user, parsed.data);
    const custodianEmail = formData.get("custodianEmail");

    if (typeof custodianEmail === "string" && custodianEmail.trim()) {
      const assignmentInput = createCustodianAssignmentSchema.safeParse({ goalId: goal.id, custodianEmail });
      if (!assignmentInput.success) return { createdGoalId: goal.id, custodianAssignment: "unavailable" };

      try {
        await createCustodianAssignment(user, assignmentInput.data);
        return { createdGoalId: goal.id, custodianAssignment: "created" };
      } catch (error) {
        if (error instanceof EligibleCustodianNotFoundError || error instanceof SelfCustodianAssignmentError) {
          return { createdGoalId: goal.id, custodianAssignment: "unavailable" };
        }
        console.error(
          "[createPersonalGoalAction] custodian assignment failed after goal creation",
          error instanceof Error ? error.name : "UnknownError",
        );
        return { createdGoalId: goal.id, custodianAssignment: "unavailable" };
      }
    }
  } catch (error) {
    if (error instanceof InvalidPersonalGoalError) {
      return { formError: error.message };
    }

    console.error(
      "[createPersonalGoalAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not create your goal. Please try again." };
  }

  redirect("/dashboard");
}

export async function completePersonalGoalAction(
  _previousState: CompletePersonalGoalActionState,
  formData: FormData,
): Promise<CompletePersonalGoalActionState> {
  const parsed = completePersonalGoalSchema.safeParse({
    goalId: formData.get("goalId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const completion = await completePersonalGoal({
      ownerId: user.id,
      goalId: parsed.data.goalId,
    });

    revalidatePath("/dashboard");
    revalidatePath("/deposits");
    revalidatePath(`/goals/${encodeURIComponent(completion.goalId)}/deposits`);

    return { status: "success", completion };
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) {
      return { status: "error", formError: "We could not complete this goal." };
    }

    if (error instanceof PersonalGoalCompletionNotEligibleError) {
      return { status: "error", formError: "This goal is not eligible for completion yet." };
    }

    if (error instanceof PersonalGoalCompletionConflictError) {
      return { status: "error", formError: "This goal cannot be completed in its current state." };
    }

    console.error(
      "[completePersonalGoalAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not complete this goal. Please try again." };
  }
}

export async function archivePersonalGoalAction(
  _previousState: ArchivePersonalGoalActionState,
  formData: FormData,
): Promise<ArchivePersonalGoalActionState> {
  const parsed = archivePersonalGoalSchema.safeParse({
    goalId: formData.get("goalId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await requireUser();

  try {
    const archive = await archivePersonalGoal({
      ownerId: user.id,
      goalId: parsed.data.goalId,
    });

    revalidatePath("/dashboard");
    revalidatePath("/deposits");
    revalidatePath(`/goals/${encodeURIComponent(archive.goalId)}/deposits`);

    return { status: "success", archive };
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) {
      return { status: "error", formError: "We could not archive this goal." };
    }

    if (error instanceof PersonalGoalArchivePendingDepositsError) {
      return { status: "error", formError: error.message };
    }

    if (error instanceof PersonalGoalArchiveConflictError) {
      return { status: "error", formError: "This goal must be completed before it can be archived." };
    }

    console.error(
      "[archivePersonalGoalAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { status: "error", formError: "We could not archive this goal. Please try again." };
  }
}
