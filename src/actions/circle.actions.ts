"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  runActivateCircleAction,
  type ActivateCircleActionState,
} from "@/src/actions/activate-circle";
import {
  runAddDraftCircleMemberAction,
  type AddDraftCircleMemberActionState,
} from "@/src/actions/add-draft-circle-member";
import {
  runCreateDraftCircleAction,
  type CreateDraftCircleActionState,
} from "@/src/actions/create-draft-circle";
import { runRemoveDraftCircleMemberAction } from "@/src/actions/remove-draft-circle-member";
import {
  runSetDraftCirclePayoutOrderAction,
  type SetDraftCirclePayoutOrderActionState,
} from "@/src/actions/set-draft-circle-payout-order";

export type {
  ActivateCircleActionState,
  AddDraftCircleMemberActionState,
  CreateDraftCircleActionState,
  SetDraftCirclePayoutOrderActionState,
};

/**
 * The real Server Action the create-circle form (7I.2) binds to
 * useActionState. All real logic -- authentication, validation, the
 * createDraftCircle call, and error mapping -- lives in
 * runCreateDraftCircleAction (create-draft-circle.ts); this function is
 * intentionally thin so the only thing left to verify here is that it
 * wires that outcome to a real redirect using the circleId the service
 * actually returned.
 */
export async function createDraftCircleAction(
  _previousState: CreateDraftCircleActionState,
  formData: FormData,
): Promise<CreateDraftCircleActionState> {
  const outcome = await runCreateDraftCircleAction(formData);

  if (!outcome.ok) return outcome.state;

  redirect(`/circles/${encodeURIComponent(outcome.circleId)}`);
}

/**
 * The real Server Action the draft workspace's add-member form (7I.3)
 * binds to useActionState. All real logic lives in
 * runAddDraftCircleMemberAction (add-draft-circle-member.ts); this
 * function only forwards the FormData and returns the resulting state --
 * there is nothing else to wire, since (unlike circle creation) a
 * successful add stays on the same page rather than redirecting.
 */
export async function addDraftCircleMemberAction(
  _previousState: AddDraftCircleMemberActionState,
  formData: FormData,
): Promise<AddDraftCircleMemberActionState> {
  return runAddDraftCircleMemberAction(formData);
}

/**
 * The real Server Action the draft workspace's per-member remove button
 * (7I.3) binds directly to a plain <form action={...}> -- a single
 * FormData argument, the same progressive-enhancement shape as the
 * existing logoutAction, since there is no inline error state to report
 * back for this action. All real logic lives in
 * runRemoveDraftCircleMemberAction (remove-draft-circle-member.ts); this
 * wrapper's only job is to revalidate the draft workspace path after a
 * genuine success, so the member list reflects the removal without a full
 * page reload.
 */
export async function removeDraftCircleMemberAction(formData: FormData): Promise<void> {
  const outcome = await runRemoveDraftCircleMemberAction(formData);

  if (outcome.ok && outcome.circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(outcome.circleId)}`);
  }
}

/**
 * The real Server Action the draft workspace's payout-order form (7I.4)
 * binds to useActionState. All real logic lives in
 * runSetDraftCirclePayoutOrderAction (set-draft-circle-payout-order.ts);
 * this wrapper only forwards the FormData, returns the resulting state,
 * and revalidates the draft workspace path after a genuine success so the
 * "Saved" indicator reflects the newly persisted order.
 */
export async function setDraftCirclePayoutOrderAction(
  _previousState: SetDraftCirclePayoutOrderActionState,
  formData: FormData,
): Promise<SetDraftCirclePayoutOrderActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runSetDraftCirclePayoutOrderAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}

/**
 * The real Server Action the draft workspace's activation review section
 * (7I.5) binds to useActionState. All real logic -- the staleness check,
 * the activateCircle call, and error mapping -- lives in
 * runActivateCircleAction (activate-circle.ts). On success this redirects
 * back to the same /circles/[circleId] URL, matching createDraftCircleAction's
 * own redirect-on-success convention: the circle is now ACTIVE, so the
 * page renders its post-activation summary branch instead of the draft
 * workspace (see page.tsx) -- there is no separate destination route.
 */
export async function activateCircleAction(
  _previousState: ActivateCircleActionState,
  formData: FormData,
): Promise<ActivateCircleActionState> {
  const outcome = await runActivateCircleAction(formData);

  if (!outcome.ok) return outcome.state;

  revalidatePath(`/circles/${encodeURIComponent(outcome.circleId)}`);
  redirect(`/circles/${encodeURIComponent(outcome.circleId)}`);
}
