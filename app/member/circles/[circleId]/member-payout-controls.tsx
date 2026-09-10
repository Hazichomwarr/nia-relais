"use client";

import { useActionState, useState } from "react";

import { confirmPayoutAction, disputePayoutAction } from "@/src/actions/payout.actions";
import { initialConfirmPayoutState, initialDisputePayoutState } from "@/src/actions/payout.state";

// Rendered only for a RECORDED payout (the parent decides that -- see
// member-payout-card.tsx). Mirrors contribution-payment-controls.tsx's
// own proven shape exactly (7J.7): confirm and dispute are two independent
// useActionState instances so a pending confirm never disables the
// dispute form's own error state or vice versa; both buttons are
// cross-disabled while either is pending so a double-submission race
// can't be triggered from this control (the backend's own compare-and-
// swap is still the real authority -- see confirmPayout/disputePayout --
// this is only belt-and-suspenders on the client, 7K.10 section 19).
//
// Neither action is called optimistically: this component never sets a
// local "confirmed"/"disputed" status of its own. On genuine success, the
// wrapping Server Action's revalidatePath refreshes the page's server
// data, which removes this control entirely once the payout is no longer
// RECORDED -- the same "let route revalidation refresh authoritative
// data" pattern as record-payout-form.tsx / record-contribution-form.tsx.
// If a stale page allowed a click that raced against the other decision,
// the action itself returns a safe terminal-conflict error (payout
// already CONFIRMED/DISPUTED) rather than this component guessing who
// won.

export function MemberPayoutControls({ circleId, payoutId }: { circleId: string; payoutId: string }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmPayoutAction,
    initialConfirmPayoutState,
  );
  const [disputeState, disputeAction, disputePending] = useActionState(
    disputePayoutAction,
    initialDisputePayoutState,
  );
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const anyPending = confirmPending || disputePending;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-5 text-[#7b8179]">
        Confirm receipt only if you actually received this payout outside NIA. Dispute it if you did not.
      </p>

      <div className="flex flex-wrap gap-2">
        <form action={confirmAction}>
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="payoutId" value={payoutId} />
          <button
            type="submit"
            disabled={anyPending}
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#35634f] px-4 text-sm font-semibold text-white transition hover:bg-[#274a3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmPending ? "Confirming…" : "Confirm receipt"}
          </button>
        </form>

        {!showDisputeForm ? (
          <button
            type="button"
            onClick={() => setShowDisputeForm(true)}
            disabled={anyPending}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#cdbda9] px-4 text-sm font-semibold text-[#8d4f42] transition hover:border-[#a53f2b] hover:bg-[#f4e6e1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Dispute
          </button>
        ) : null}
      </div>

      {confirmState.formError ? (
        <p role="alert" className="text-sm font-medium text-[#b3261e]">
          {confirmState.formError}
        </p>
      ) : null}

      {showDisputeForm ? (
        <form
          action={disputeAction}
          className="mt-1 flex flex-col gap-2 rounded-xl border border-[#e4d9c8] bg-white/70 p-3"
        >
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="payoutId" value={payoutId} />
          <label htmlFor={`dispute-reason-${payoutId}`} className="text-xs font-semibold text-[#173b32]">
            Tell us what was wrong with this payout
          </label>
          <textarea
            id={`dispute-reason-${payoutId}`}
            name="disputeReason"
            required
            maxLength={500}
            rows={3}
            value={disputeReason}
            onChange={(event) => setDisputeReason(event.target.value)}
            aria-invalid={Boolean(disputeState.fieldErrors?.disputeReason)}
            aria-describedby={`dispute-reason-${payoutId}-error`}
            className="rounded-lg border border-[#cdbda9] bg-white p-2 text-sm break-words outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30"
          />
          {disputeState.fieldErrors?.disputeReason?.length ? (
            <p id={`dispute-reason-${payoutId}-error`} role="alert" className="text-xs text-[#b3261e]">
              {disputeState.fieldErrors.disputeReason.join(" ")}
            </p>
          ) : null}
          {disputeState.formError ? (
            <p role="alert" className="text-sm font-medium text-[#b3261e]">
              {disputeState.formError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={anyPending || disputeReason.trim().length === 0}
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#a53f2b] px-4 text-sm font-semibold text-white transition hover:bg-[#8a3222] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {disputePending ? "Submitting dispute…" : "Submit dispute"}
            </button>
            <button
              type="button"
              onClick={() => {
                // Cancelling performs no mutation -- a plain, un-submitted
                // local state change back to the collapsed control, same
                // as contribution-payment-controls.tsx's own reject-form
                // cancel. disputeAction is never invoked here, and the
                // typed-in reason is intentionally kept only while the
                // form stays open -- it is not preserved once cancelled.
                setShowDisputeForm(false);
                setDisputeReason("");
              }}
              disabled={disputePending}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#cdbda9] px-4 text-sm font-semibold text-[#173b32] transition hover:border-[#b96549] hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
