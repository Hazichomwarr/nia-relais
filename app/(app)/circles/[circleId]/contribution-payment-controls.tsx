"use client";

import { useActionState, useState } from "react";

import { confirmContributionAction, rejectContributionAction } from "@/src/actions/circle.actions";
import { initialConfirmContributionState, initialRejectContributionState } from "@/src/actions/circle.state";

// Rendered only for a RECORDED payment (the parent decides that -- see
// contribution-desk.tsx). Confirm and reject are two independent
// useActionState instances so a pending confirm never disables the reject
// form's own error state or vice versa; both buttons are cross-disabled
// while either is pending so a double-submission race can't be triggered
// from this control (the backend's own compare-and-swap is still the real
// authority -- see confirmContribution/rejectContribution -- this is only
// belt-and-suspenders on the client).
//
// Neither action is called optimistically: this component never sets a
// local "confirmed"/"rejected" status of its own. On genuine success, the
// wrapping Server Action's revalidatePath refreshes the page's server data,
// which removes this control entirely once the payment is no longer
// RECORDED -- the same "let route revalidation refresh authoritative data"
// pattern as record-contribution-form.tsx.

export function ContributionPaymentControls({ circleId, paymentId }: { circleId: string; paymentId: string }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmContributionAction,
    initialConfirmContributionState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectContributionAction,
    initialRejectContributionState,
  );
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const anyPending = confirmPending || rejectPending;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-5 text-[#7b8179]">
        Confirm only if this contribution was actually received outside NIA. NIA does not hold or transfer money.
      </p>

      <div className="flex flex-wrap gap-2">
        <form action={confirmAction}>
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="paymentId" value={paymentId} />
          <button
            type="submit"
            disabled={anyPending}
            className="inline-flex min-h-9 items-center justify-center rounded-full bg-[#35634f] px-4 text-xs font-semibold text-white transition hover:bg-[#274a3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmPending ? "Confirming…" : "Confirm received"}
          </button>
        </form>

        {!showRejectForm ? (
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            disabled={anyPending}
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#cdbda9] px-4 text-xs font-semibold text-[#8d4f42] transition hover:border-[#a53f2b] hover:bg-[#f4e6e1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reject
          </button>
        ) : null}
      </div>

      {confirmState.formError ? (
        <p role="alert" className="text-xs font-medium text-[#b3261e]">
          {confirmState.formError}
        </p>
      ) : null}

      {showRejectForm ? (
        <form action={rejectAction} className="mt-1 flex flex-col gap-2 rounded-xl border border-[#e4d9c8] bg-white/70 p-3">
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="paymentId" value={paymentId} />
          <label htmlFor={`reject-reason-${paymentId}`} className="text-xs font-semibold text-[#173b32]">
            Rejection reason
          </label>
          <textarea
            id={`reject-reason-${paymentId}`}
            name="rejectionReason"
            required
            maxLength={500}
            rows={2}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            aria-invalid={Boolean(rejectState.fieldErrors?.rejectionReason)}
            aria-describedby={`reject-reason-${paymentId}-error`}
            className="rounded-lg border border-[#cdbda9] bg-white p-2 text-sm outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30"
          />
          {rejectState.fieldErrors?.rejectionReason?.length ? (
            <p id={`reject-reason-${paymentId}-error`} role="alert" className="text-xs text-[#b3261e]">
              {rejectState.fieldErrors.rejectionReason.join(" ")}
            </p>
          ) : null}
          {rejectState.formError ? (
            <p role="alert" className="text-xs font-medium text-[#b3261e]">
              {rejectState.formError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={anyPending || rejectionReason.trim().length === 0}
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-[#a53f2b] px-4 text-xs font-semibold text-white transition hover:bg-[#8a3222] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rejectPending ? "Rejecting…" : "Reject contribution"}
            </button>
            <button
              type="button"
              onClick={() => {
                // Cancelling performs no mutation -- a plain, un-submitted
                // local state change back to the collapsed control (7J.7
                // section 8). Neither rejectAction nor any other Server
                // Action is invoked here.
                setShowRejectForm(false);
                setRejectionReason("");
              }}
              disabled={rejectPending}
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#cdbda9] px-4 text-xs font-semibold text-[#173b32] transition hover:border-[#b96549] hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
