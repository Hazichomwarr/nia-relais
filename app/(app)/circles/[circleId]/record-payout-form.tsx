"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { recordPayoutAction } from "@/src/actions/payout.actions";
import { initialRecordPayoutState } from "@/src/actions/payout.state";

// Mirrors record-contribution-form.tsx's own proven pattern exactly
// (7J.7 section 6/9, carried forward unchanged for payouts, 7K.9 section
// 9): clientOperationId is generated ONCE per submission intent,
// client-side only -- never in the Server Action. It stays stable across
// a pending rerender or a retry of the SAME intent (nothing here
// regenerates it while state.status !== "success"), and a fresh id is
// generated only once a submission has genuinely completed successfully.
//
// The amount is never a free-form field: it is a hidden input fixed to
// the round's own authoritative expectedPayout.amount (getOwnerCirclePayouts,
// 7K.7), displayed read-only next to it -- this component never sums
// obligations or computes contributionAmount x memberCount itself (7K.9
// section 8); recordPayout's own domain contract independently re-verifies
// the exact match regardless of what is submitted here.

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RecordPayoutForm({
  circleId,
  roundId,
  amount,
  currency,
}: {
  circleId: string;
  roundId: string;
  amount: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordPayoutAction, initialRecordPayoutState);
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
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="amount" value={amount} readOnly />
      <input type="hidden" name="clientOperationId" value={clientOperationId} readOnly />

      <p className="text-sm text-[#173b32]">
        Record the exact expected payout:{" "}
        <span className="font-semibold">
          {currency} {amount}
        </span>
      </p>
      <p className="mt-1 text-xs leading-5 text-[#7b8179]">
        This records that you already paid this amount to the recipient outside NIA. NIA does not send, hold, or
        transfer money.
      </p>

      {state.status === "success" && state.payout ? (
        <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-[#35634f]">
          {state.payout.status === "RECORDED"
            ? "Recorded — waiting for the recipient's decision."
            : state.payout.status === "CONFIRMED"
              ? "This payout is already confirmed by the recipient."
              : "This payout was already disputed by the recipient."}
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
        {pending ? "Recording…" : "Record payout"}
      </button>
    </form>
  );
}
