"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";

import {
  createDepositAction,
  type CreateDepositActionState,
} from "@/src/actions/deposit.actions";
import { initialCreateDepositState } from "@/src/actions/deposit.state";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import { localizePersonalSavingsError } from "@/src/i18n/personal-savings-error-presentation";
import { formatMoney } from "@/src/i18n/format";

type DepositFormProps = {
  goalId: string;
  goal: {
    name: string;
    currency: string;
    weeklyAmount: string;
    startDate: string;
  };
  dictionary: Dictionary;
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

export default function DepositForm({ goalId, goal, dictionary }: DepositFormProps) {
  const copy = dictionary.personalSavings;
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
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{copy.recordSavings}</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">{goal.name}</h1>
            <p className="mt-3 text-base leading-7 text-[#587066]">
              {copy.recordSavingsDescription}
            </p>
          </div>

          <div className="mt-7 rounded-2xl bg-[#fff4e8] p-4 text-sm leading-6 text-[#587066]">
            {copy.commitmentNotice.replace("{currency}", goal.currency).replace("{amount}", goal.weeklyAmount)}
          </div>

          {state.success ? (
            <section className="mt-6 rounded-2xl border border-[#d7e5d7] bg-[#edf5eb] p-5 text-[#315b4b]" role="status" aria-live="polite">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#d7e5d7] font-serif text-lg text-[#315b4b]" aria-hidden="true">✦</span>
                <div>
                  <h2 className="font-semibold text-[#173b32]">
                    {state.success.status === "APPROVED" ? copy.approvedSuccessTitle : copy.pendingSuccessTitle}
                  </h2>
                  <p className="mt-1 text-sm leading-6">
                    {state.success.status === "APPROVED"
                      ? copy.approvedSuccessDescription.replace("{amount}", successAmount ?? "")
                      : copy.pendingSuccessDescription.replace("{amount}", successAmount ?? "")}
                  </p>
                  <Link
                    href={savingsHistoryHref}
                    className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full border border-[#a9c5b0] px-4 text-sm font-semibold text-[#315b4b] transition hover:bg-[#e1efdf] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
                  >
                    {copy.viewSavings}
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          <form ref={formRef} action={formAction} onInput={handleFormInput} className="mt-8 space-y-6">
            <input type="hidden" name="goalId" value={goalId} />
            <input type="hidden" name="clientOperationId" value={clientOperationId} readOnly />

            <label className="block" htmlFor="deposit-amount">
              <span className="text-sm font-semibold">{copy.amountSaved}</span><span className="mt-1 block text-sm text-[#7b8179]">{copy.currency}: {goal.currency}</span>
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
              <span className="text-sm font-semibold">{copy.dateSaved}</span>
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
              <span className="text-sm font-semibold">{copy.note} <span className="font-normal text-[#7b8179]">({copy.optional})</span></span>
              <textarea
                id="deposit-note"
                name="note"
                rows={3}
                maxLength={500}
                placeholder={copy.notePlaceholder}
                aria-invalid={Boolean(state.fieldErrors?.note)}
                aria-describedby="deposit-note-error"
                className="mt-2 w-full resize-y rounded-xl border border-[#d8cec0] bg-white px-4 py-3 text-base outline-none transition focus:border-[#b96549] focus:ring-2 focus:ring-[#f2d2bd]"
              />
              <FieldError id="deposit-note-error" errors={state.fieldErrors?.note} />
            </label>

            {state.fieldErrors?.clientOperationId?.length ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                {copy.recordingIdentifierError}
              </p>
            ) : null}

            {state.formError ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                {localizePersonalSavingsError(state.formError, dictionary)}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="min-h-12 w-full rounded-full bg-[#b96549] px-5 text-base font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? copy.recording : copy.recordSavings}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function formatAmount(value: string, currency: string) {
  return formatMoney(value, currency);
}
