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
  runConfirmContributionAction,
  type ConfirmContributionActionState,
} from "@/src/actions/confirm-contribution";
import {
  runCreateDraftCircleAction,
  type CreateDraftCircleActionState,
} from "@/src/actions/create-draft-circle";
import {
  runRecordContributionAction,
  type RecordContributionActionState,
} from "@/src/actions/record-contribution";
import { runRejectContributionAction, type RejectContributionActionState } from "@/src/actions/reject-contribution";
import { runRemoveDraftCircleMemberAction } from "@/src/actions/remove-draft-circle-member";
import {
  runSetDraftCirclePayoutOrderAction,
  type SetDraftCirclePayoutOrderActionState,
} from "@/src/actions/set-draft-circle-payout-order";

// No `export type { ... }` re-export here, deliberately (hotfix, P1): a
// "use server" file's export list is scanned by the Next.js/Turbopack
// Server Action transform as if every named export were a callable
// action reference, regardless of the `type` keyword on the specifier --
// type-only re-exports are erased by the TypeScript compiler (no runtime
// binding survives), but the transform still emits
// `registerServerReference(<name>, ...)` for them, producing a
// `ReferenceError: <Name> is not defined` at module-evaluation time. Each
// action-state type is imported directly from its own owning module
// (activate-circle.ts, add-draft-circle-member.ts, ...) by whichever
// state/UI file actually needs it -- never re-exported from this file.

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

/**
 * The real Server Action the future owner contribution-recording UI
 * (7J.7, not built by this ticket) will bind to useActionState. All real
 * logic -- requireUser(), form validation, the recordContribution call,
 * and error mapping -- lives in runRecordContributionAction
 * (record-contribution.ts, 7J.6); this wrapper only forwards the
 * FormData and revalidates the circle summary route after a genuine
 * success (a fresh recording, or a legitimate idempotent replay), never
 * on a validation/domain failure. There is no separate "contribution
 * desk" route yet -- /circles/[circleId] is the only owner-facing circle
 * route that exists today, so it is the only one revalidated here.
 */
export async function recordContributionAction(
  _previousState: RecordContributionActionState,
  formData: FormData,
): Promise<RecordContributionActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runRecordContributionAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}

/**
 * The real Server Action the future owner confirmation/rejection UI
 * (7J.8, not built by this ticket) will bind to useActionState. All real
 * logic lives in runConfirmContributionAction (confirm-contribution.ts,
 * 7J.6); this wrapper only forwards the FormData and revalidates the
 * circle summary route after a genuine success (a fresh confirmation, or
 * a legitimate replay of an already-CONFIRMED payment).
 */
export async function confirmContributionAction(
  _previousState: ConfirmContributionActionState,
  formData: FormData,
): Promise<ConfirmContributionActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runConfirmContributionAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}

/**
 * The real Server Action the future owner confirmation/rejection UI
 * (7J.8, not built by this ticket) will bind to useActionState. All real
 * logic lives in runRejectContributionAction (reject-contribution.ts,
 * 7J.6); this wrapper only forwards the FormData and revalidates the
 * circle summary route after a genuine success (a fresh rejection, or a
 * legitimate exact-intent replay of an already-REJECTED payment).
 */
export async function rejectContributionAction(
  _previousState: RejectContributionActionState,
  formData: FormData,
): Promise<RejectContributionActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runRejectContributionAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}
