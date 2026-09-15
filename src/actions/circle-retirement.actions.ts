"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/src/auth/require-user";
import {
  archiveCircle,
  cancelCircle,
  deleteDraftCircle,
  CircleDraftDeletionBlockedError,
  CircleRetirementConflictError,
  CircleRetirementNotFoundOrUnauthorizedError,
} from "@/src/services/circle-retirement.service";

export type CircleRetirementActionState = { status?: "success" | "error"; formError?: string };

async function runCircleRetirementAction(
  formData: FormData,
  operation: "delete" | "cancel" | "archive",
): Promise<CircleRetirementActionState> {
  const circleId = String(formData.get("circleId") ?? "").trim();
  if (!circleId) return { status: "error", formError: "This circle is no longer available." };
  try {
    const user = await requireUser();
    if (operation === "delete") await deleteDraftCircle({ ownerId: user.id, circleId });
    if (operation === "cancel") await cancelCircle({ ownerId: user.id, circleId });
    if (operation === "archive") await archiveCircle({ ownerId: user.id, circleId });
    revalidatePath("/circles");
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
    revalidatePath(`/member/circles/${encodeURIComponent(circleId)}`);
    return { status: "success" };
  } catch (error) {
    if (error instanceof CircleRetirementNotFoundOrUnauthorizedError) return { status: "error", formError: "This circle is no longer available." };
    if (error instanceof CircleDraftDeletionBlockedError) return { status: "error", formError: "This draft contains historical records and cannot be deleted." };
    if (error instanceof CircleRetirementConflictError) return { status: "error", formError: "This circle cannot be changed in its current state." };
    console.error("[circle-retirement] unexpected failure", { operation, errorClass: error instanceof Error ? error.name : "UnknownError" });
    return { status: "error", formError: "We could not update this circle. Please try again." };
  }
}

export async function deleteDraftCircleAction(_previousState: CircleRetirementActionState, formData: FormData) {
  const result = await runCircleRetirementAction(formData, "delete");
  if (result.status === "success") redirect("/circles");
  return result;
}

export async function cancelCircleAction(_previousState: CircleRetirementActionState, formData: FormData) {
  return runCircleRetirementAction(formData, "cancel");
}

export async function archiveCircleAction(_previousState: CircleRetirementActionState, formData: FormData) {
  return runCircleRetirementAction(formData, "archive");
}
