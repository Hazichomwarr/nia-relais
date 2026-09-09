"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { recordContributionAction } from "@/src/actions/circle.actions";
import { initialRecordContributionState } from "@/src/actions/circle.state";

// clientOperationId is generated ONCE per submission intent, client-side
// only -- never in the Server Action (7J.7 section 6). It stays stable
// across a pending rerender or a retry of the SAME intent (nothing here
// regenerates it while state.status !== "success"), and a fresh id is
// generated only once a submission has genuinely completed successfully --
// mirroring deposit-form.tsx's own proven operationId()/handleFormInput
// pattern exactly, the closest existing precedent for a client-generated,
// server-forwarded idempotency key.
//
// The amount is never a free-form field: it is a hidden input fixed to the
// obligation's own frozen expectedAmount, displayed read-only next to it --
// recordContribution's own domain contract requires an exact match, and
// this form never invites the owner to edit it as if partial payment were
// supported (7J.7 section 6).

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `contribution-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RecordContributionForm({
  circleId,
  obligationId,
  amount,
  currency,
}: {
  circleId: string;
  obligationId: string;
  amount: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordContributionAction, initialRecordContributionState);
  const [clientOperationId, setClientOperationId] = useState(operationId);
  const formRef = useRef<HTMLFormElement>(null);

  function handleFormInput() {
    if (state.status === "success") setClientOperationId(operationId());
  }

  useEffect(() => {
    if (state.status !== "success") return;
    formRef.current?.reset();
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={handleFormInput}
      className="rounded-xl border border-[#e4d9c8] bg-white/70 p-3"
    >
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="obligationId" value={obligationId} />
      <input type="hidden" name="amount" value={amount} readOnly />
      <input type="hidden" name="clientOperationId" value={clientOperationId} readOnly />

      <p className="text-sm text-[#173b32]">
        Record the exact expected contribution:{" "}
        <span className="font-semibold">
          {currency} {amount}
        </span>
      </p>
      <p className="mt-1 text-xs text-[#7b8179]">
        NIA does not support partial payments -- only this exact amount can be recorded.
      </p>

      {state.status === "success" && state.payment ? (
        <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-[#35634f]">
          {state.payment.status === "RECORDED"
            ? "Recorded — awaiting your confirmation."
            : state.payment.status === "CONFIRMED"
              ? "This contribution is already confirmed."
              : "This contribution was already rejected."}
        </p>
      ) : null}

      {state.fieldErrors?.amount?.length || state.fieldErrors?.clientOperationId?.length ? (
        <p role="alert" className="mt-2 text-sm font-medium text-[#b3261e]">
          We could not identify this recording. Please refresh and try again.
        </p>
      ) : null}

      {state.formError ? (
        <p role="alert" className="mt-2 text-sm font-medium text-[#b3261e]">
          {state.formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex min-h-10 items-center justify-center rounded-full bg-[#b96549] px-4 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Recording…" : "Record contribution"}
      </button>
    </form>
  );
}
