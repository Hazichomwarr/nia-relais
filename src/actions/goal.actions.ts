"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/src/auth/require-user";
import {
  createPersonalGoal,
  InvalidPersonalGoalError,
} from "@/src/services/goal.service";
import { createPersonalGoalSchema } from "@/src/validations/goal.schema";

export type CreatePersonalGoalActionState = {
  fieldErrors?: Partial<
    Record<
      "name" | "currency" | "targetAmount" | "weeklyAmount" | "startDate",
      string[]
    >
  >;
  formError?: string;
};

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
    await createPersonalGoal(user, parsed.data);
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
