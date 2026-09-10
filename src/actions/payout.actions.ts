"use server";

import { revalidatePath } from "next/cache";

import { runConfirmPayoutAction, type ConfirmPayoutActionState } from "@/src/actions/confirm-payout";
import { runDisputePayoutAction, type DisputePayoutActionState } from "@/src/actions/dispute-payout";
import { runRecordPayoutAction, type RecordPayoutActionState } from "@/src/actions/record-payout";

export type { ConfirmPayoutActionState, DisputePayoutActionState, RecordPayoutActionState };

/**
 * The real Server Action a future owner payout-recording UI (7K.9, not
 * built by this ticket) will bind to useActionState. All real logic --
 * requireUser(), form validation, the recordPayout call, and error
 * mapping -- lives in runRecordPayoutAction (record-payout.ts, 7K.6);
 * this wrapper only forwards the FormData and revalidates the owner
 * circle route after a genuine success (a fresh recording, or a
 * legitimate idempotent replay), never on a validation/domain failure.
 */
export async function recordPayoutAction(
  _previousState: RecordPayoutActionState,
  formData: FormData,
): Promise<RecordPayoutActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runRecordPayoutAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}

/**
 * The real Server Action a future recipient confirmation UI (7K.10, not
 * built by this ticket) will bind to useActionState. All real logic lives
 * in runConfirmPayoutAction (confirm-payout.ts, 7K.6); this wrapper only
 * forwards the FormData and revalidates the member circle route after a
 * genuine success (a fresh confirmation, or a legitimate replay of an
 * already-CONFIRMED payout).
 */
export async function confirmPayoutAction(
  _previousState: ConfirmPayoutActionState,
  formData: FormData,
): Promise<ConfirmPayoutActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runConfirmPayoutAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/member/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}

/**
 * The real Server Action a future recipient dispute UI (7K.10, not built
 * by this ticket) will bind to useActionState. All real logic lives in
 * runDisputePayoutAction (dispute-payout.ts, 7K.6); this wrapper only
 * forwards the FormData and revalidates the member circle route after a
 * genuine success (a fresh dispute, or a legitimate exact-intent replay
 * of an already-DISPUTED payout).
 */
export async function disputePayoutAction(
  _previousState: DisputePayoutActionState,
  formData: FormData,
): Promise<DisputePayoutActionState> {
  const circleId = String(formData.get("circleId") ?? "");
  const outcome = await runDisputePayoutAction(formData);

  if (outcome.status === "success" && circleId.length > 0) {
    revalidatePath(`/member/circles/${encodeURIComponent(circleId)}`);
  }

  return outcome;
}
