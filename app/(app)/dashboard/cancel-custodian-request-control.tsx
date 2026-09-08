"use client";

import { useState } from "react";
import { useActionState } from "react";

import {
  cancelCustodianAssignmentRequestAction,
  type CancelCustodianAssignmentActionState,
} from "@/src/actions/custodian.actions";

export function CancelCustodianRequestControl({ assignmentId }: { assignmentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<
    CancelCustodianAssignmentActionState,
    FormData
  >(cancelCustodianAssignmentRequestAction, {});

  if (state.status === "success") {
    return (
      <p className="mt-4 rounded-2xl bg-[#e5efe5] p-4 text-sm leading-6 text-[#315b4b]" role="status">
        Request cancelled.
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-4 text-sm font-semibold text-[#6d665d] transition hover:bg-[#fffaf0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035]"
        aria-expanded="false"
        aria-controls={`cancel-custodian-confirmation-${assignmentId}`}
      >
        Cancel request
      </button>
    );
  }

  return (
    <div
      id={`cancel-custodian-confirmation-${assignmentId}`}
      className="mt-4 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-4"
      role="region"
      aria-label="Confirm cancelling custodian request"
    >
      <p className="text-sm leading-6 text-[#5a6b61]">
        This request has not been accepted yet. Cancelling it will close the request, and you can invite another trusted person afterward.
      </p>

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#b96549] px-4 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Cancelling request…" : "Confirm cancellation"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-4 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Keep request
        </button>
      </form>

      {state.fieldErrors?.assignmentId?.map((error) => (
        <p key={error} className="mt-3 text-sm text-[#a53f2b]" role="alert">
          {error}
        </p>
      ))}
      {state.formError ? (
        <p className="mt-3 text-sm text-[#a53f2b]" role="alert">
          {state.formError}
        </p>
      ) : null}
    </div>
  );
}
