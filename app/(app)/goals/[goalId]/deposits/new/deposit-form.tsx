"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";

import {
  createDepositAction,
  type CreateDepositActionState,
} from "@/src/actions/deposit.actions";
import { initialCreateDepositState } from "@/src/actions/deposit.state";

type DepositFormProps = {
  goalId: string;
  goal: {
    name: string;
    currency: string;
    weeklyAmount: string;
    startDate: string;
  };
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;

  return (
    <p id={id} className="mt-1 text-sm text-red-700" role="alert">
      {errors.join(" ")}
    </p>
  );
}

export default function DepositForm({ goalId, goal }: DepositFormProps) {
  const [state, formAction, pending] = useActionState<CreateDepositActionState, FormData>(
    createDepositAction,
    initialCreateDepositState,
  );
  const [clientOperationId, setClientOperationId] = useState(operationId);
  const formRef = useRef<HTMLFormElement>(null);
  const today = todayDate();

  function handleFormInput() {
    if (state.success) setClientOperationId(operationId());
  }

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
  }, [state.success]);

  const successAmount = state.success ? formatAmount(state.success.amount, goal.currency) : null;
  const savingsHistoryHref = `/goals/${encodeURIComponent(goalId)}/deposits`;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        <div className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">Record savings</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">{goal.name}</h1>
            <p className="mt-3 text-base leading-7 text-[#587066]">
              Record what you saved toward this goal. NIA does not hold or receive the money.
            </p>
          </div>

          <div className="mt-7 rounded-2xl bg-[#fff4e8] p-4 text-sm leading-6 text-[#587066]">
            Your weekly commitment is {goal.currency} {goal.weeklyAmount}, but you can record any amount you actually saved.
          </div>

          {state.success ? (
            <section className="mt-6 rounded-2xl border border-[#d7e5d7] bg-[#edf5eb] p-5 text-[#315b4b]" role="status" aria-live="polite">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#d7e5d7] font-serif text-lg text-[#315b4b]" aria-hidden="true">✦</span>
                <div>
                  <h2 className="font-semibold text-[#173b32]">
                    {state.success.status === "APPROVED" ? "Another step toward your dream." : "Your savings were recorded."}
                  </h2>
                  <p className="mt-1 text-sm leading-6">
                    {state.success.status === "APPROVED"
                      ? `${successAmount} has been added to your savings.`
                      : `${successAmount} is waiting for your trusted person to confirm it.`}
                  </p>
                  <Link
                    href={savingsHistoryHref}
                    className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full border border-[#a9c5b0] px-4 text-sm font-semibold text-[#315b4b] transition hover:bg-[#e1efdf] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
                  >
                    View savings
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          <form ref={formRef} action={formAction} onInput={handleFormInput} className="mt-8 space-y-6">
            <input type="hidden" name="goalId" value={goalId} />
            <input type="hidden" name="clientOperationId" value={clientOperationId} readOnly />

            <label className="block" htmlFor="deposit-amount">
              <span className="text-sm font-semibold">Amount saved</span>
              <span className="mt-1 block text-sm text-[#7b8179]">Currency: {goal.currency}</span>
              <input
                id="deposit-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                required
                placeholder="0.00"
                aria-invalid={Boolean(state.fieldErrors?.amount)}
                aria-describedby="deposit-amount-error"
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d8cec0] bg-white px-4 text-base outline-none transition focus:border-[#b96549] focus:ring-2 focus:ring-[#f2d2bd]"
              />
              <FieldError id="deposit-amount-error" errors={state.fieldErrors?.amount} />
            </label>

            <label className="block" htmlFor="deposit-date">
              <span className="text-sm font-semibold">Date saved</span>
              <input
                id="deposit-date"
                name="depositDate"
                type="date"
                required
                defaultValue={today}
                min={goal.startDate}
                max={today}
                aria-invalid={Boolean(state.fieldErrors?.depositDate)}
                aria-describedby="deposit-date-error"
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d8cec0] bg-white px-4 text-base outline-none transition focus:border-[#b96549] focus:ring-2 focus:ring-[#f2d2bd]"
              />
              <FieldError id="deposit-date-error" errors={state.fieldErrors?.depositDate} />
            </label>

            <label className="block" htmlFor="deposit-note">
              <span className="text-sm font-semibold">Note <span className="font-normal text-[#7b8179]">(optional)</span></span>
              <textarea
                id="deposit-note"
                name="note"
                rows={3}
                maxLength={500}
                placeholder="What was this saving for?"
                aria-invalid={Boolean(state.fieldErrors?.note)}
                aria-describedby="deposit-note-error"
                className="mt-2 w-full resize-y rounded-xl border border-[#d8cec0] bg-white px-4 py-3 text-base outline-none transition focus:border-[#b96549] focus:ring-2 focus:ring-[#f2d2bd]"
              />
              <FieldError id="deposit-note-error" errors={state.fieldErrors?.note} />
            </label>

            {state.fieldErrors?.clientOperationId?.length ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                We could not identify this recording. Please refresh and try again.
              </p>
            ) : null}

            {state.formError ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                {state.formError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="min-h-12 w-full rounded-full bg-[#b96549] px-5 text-base font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Recording…" : "Record savings"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function formatAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}
