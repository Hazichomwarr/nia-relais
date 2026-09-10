"use server";

import { revalidatePath } from "next/cache";

import { runActivateFirstRoundAction, type ActivateFirstRoundActionState } from "@/src/actions/activate-first-round";
import { runAdvanceRoundAction, type AdvanceRoundActionState } from "@/src/actions/advance-round";

export type { ActivateFirstRoundActionState, AdvanceRoundActionState };

// The real Server Actions a future owner round-lifecycle UI (not built by
// this ticket) will bind to useActionState. All real logic --
// requireUser(), input whitelisting, the activateFirstRound/advanceRound
// call, and error mapping -- lives in the two testable cores
// (activate-first-round.ts / advance-round.ts, 7K.14); these wrappers
// only forward the FormData and revalidate after a genuine success (a
// fresh transition, or a legitimate idempotent replay), never on a
// validation/domain failure.
//
// Revalidation scope (7K.14 section 12, audited rather than guessed):
// both actions revalidate the owner circle route AND every member's
// shared /member/circles/${circleId} route. This is a deliberate
// departure from payout.actions.ts's own recordPayoutAction (owner route
// only) -- unlike recording a payout (which changes only the OWNER's own
// payout desk until a recipient later confirms/disputes it), starting or
// advancing a round changes what selectCurrentAndNextRound
// (circle-round-selection.ts) resolves as the CURRENT round for every
// member of the circle: before activateFirstRound, with every round still
// UPCOMING, there is no current round to show at all; after advanceRound,
// the round that closes stops being current and its successor (if any)
// becomes it. That shift is member-visible on their own dashboard, not
// only on the owner's, so the member route's cached render is genuinely
// stale after either operation succeeds -- revalidating only the owner
// route here would leave members looking at a stale round.

export async function activateFirstRoundAction(
  _previousState: ActivateFirstRoundActionState,
  formData: FormData,
): Promise<ActivateFirstRoundActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runActivateFirstRoundAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
    revalidatePath(`/member/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}

export async function advanceRoundAction(
  _previousState: AdvanceRoundActionState,
  formData: FormData,
): Promise<AdvanceRoundActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runAdvanceRoundAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
    revalidatePath(`/member/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}
