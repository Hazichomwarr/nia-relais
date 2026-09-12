"use server";

import { revalidatePath } from "next/cache";

import { runCompleteCircleAction, type CompleteCircleActionState } from "@/src/actions/complete-circle";

export type { CompleteCircleActionState };

// The real Server Action a future "Complete circle" UI (7L.3, not built by
// this ticket) will bind to useActionState. All real logic --
// requireUser(), input whitelisting, the completeCircle call, and error
// mapping -- lives in the testable core (complete-circle.ts, 7L.2); this
// wrapper only forwards the FormData and revalidates after a genuine
// success (a fresh completion, or a legitimate idempotent replay), never
// on a validation/domain failure.
//
// Revalidation scope (7L.2, audited rather than guessed, mirroring
// round-lifecycle.actions.ts's own two-route precedent): both the owner
// circle route AND every member's shared /member/circles/${circleId}
// route are revalidated. This is deliberate, not copy-pasted blindly --
// app/member/circles/[circleId]/member-dashboard.tsx already renders
// circle.status directly (a "COMPLETED" badge and its own dedicated copy
// branch, verified by direct inspection), so a member's cached render is
// genuinely stale the instant their circle becomes COMPLETED, exactly the
// same reasoning that already justified revalidating the member route for
// activateFirstRound/advanceRound.
//
// No redirect: the owner circle route does not yet understand COMPLETED
// (the known P1, docs/product/susu-circle-completion-audit.md §14/§21/§27)
// -- that is 7L.3's job, together with the owner workspace fix, so this
// action is never wired to send an owner anywhere. It remains
// independently testable without that dependency.

export async function completeCircleAction(
  _previousState: CompleteCircleActionState,
  formData: FormData,
): Promise<CompleteCircleActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runCompleteCircleAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
    revalidatePath(`/member/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}
