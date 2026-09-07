"use client";

import { useState } from "react";
import { useActionState } from "react";

import {
  createPersonalGoalAction,
  type CreatePersonalGoalActionState,
} from "@/src/actions/goal.actions";
import { initialCreatePersonalGoalState } from "@/src/actions/goal.state";

const currencies = ["USD", "XOF", "EUR"] as const;

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;

  return (
    <p id={id} className="mt-1 text-sm text-red-700" role="alert">
      {errors.join(" ")}
    </p>
  );
}

export default function NewGoalForm() {
  const [state, formAction, pending] = useActionState<
    CreatePersonalGoalActionState,
    FormData
  >(createPersonalGoalAction, initialCreatePersonalGoalState);
  const [startDate, setStartDate] = useState(todayDate);
  const today = todayDate();
  const unlockMin = startDate > today ? startDate : today;

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-amber-700">Personal savings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create a goal</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600">
          Turn something important to you into a clear, steady commitment.
        </p>
      </div>

      <form action={formAction} className="space-y-7">
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">What are you saving for?</h2>
            <p className="mt-1 text-sm text-zinc-600">Give your goal a name you will want to come back to.</p>
          </div>
          <label className="block" htmlFor="goal-name">
            <span className="text-sm font-medium">Goal name</span>
            <input
              id="goal-name"
              name="name"
              required
              maxLength={100}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              aria-describedby="goal-name-error"
              className="mt-2 min-h-12 w-full rounded-xl border border-zinc-300 px-4 text-base outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
            />
            <FieldError id="goal-name-error" errors={state.fieldErrors?.name} />
          </label>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">How much do you want to reach?</h2>
            <p className="mt-1 text-sm text-zinc-600">Set a target and choose the currency for this goal.</p>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="block" htmlFor="target-amount">
              <span className="text-sm font-medium">Target amount</span>
              <input
                id="target-amount"
                name="targetAmount"
                type="text"
                inputMode="decimal"
                required
                placeholder="0.00"
                aria-invalid={Boolean(state.fieldErrors?.targetAmount)}
                aria-describedby="target-amount-error"
                className="mt-2 min-h-12 w-full rounded-xl border border-zinc-300 px-4 text-base outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
              />
              <FieldError id="target-amount-error" errors={state.fieldErrors?.targetAmount} />
            </label>
            <label className="block" htmlFor="currency">
              <span className="text-sm font-medium">Currency</span>
              <select
                id="currency"
                name="currency"
                defaultValue="USD"
                aria-invalid={Boolean(state.fieldErrors?.currency)}
                aria-describedby="currency-error"
                className="mt-2 min-h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
              >
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
              <FieldError id="currency-error" errors={state.fieldErrors?.currency} />
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">How much will you commit each week?</h2>
            <p className="mt-1 text-sm text-zinc-600">Weekly saving is part of every Personal Goal.</p>
          </div>
          <label className="block" htmlFor="weekly-amount">
            <span className="text-sm font-medium">Weekly commitment</span>
            <input
              id="weekly-amount"
              name="weeklyAmount"
              type="text"
              inputMode="decimal"
              required
              placeholder="0.00"
              aria-invalid={Boolean(state.fieldErrors?.weeklyAmount)}
              aria-describedby="weekly-amount-error"
              className="mt-2 min-h-12 w-full rounded-xl border border-zinc-300 px-4 text-base outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
            />
            <FieldError id="weekly-amount-error" errors={state.fieldErrors?.weeklyAmount} />
          </label>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Set your timeline</h2>
            <p className="mt-1 text-sm text-zinc-600">Choose when the commitment starts and when the money unlocks.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="start-date">
              <span className="text-sm font-medium">Start date</span>
              <input
                id="start-date"
                name="startDate"
                type="date"
                required
                max={today}
                defaultValue={today}
                onChange={(event) => setStartDate(event.target.value)}
                aria-invalid={Boolean(state.fieldErrors?.startDate)}
                aria-describedby="start-date-error"
                className="mt-2 min-h-12 w-full rounded-xl border border-zinc-300 px-4 text-base outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
              />
              <FieldError id="start-date-error" errors={state.fieldErrors?.startDate} />
            </label>
            <label className="block" htmlFor="unlock-date">
              <span className="text-sm font-medium">Unlock date</span>
              <input
                id="unlock-date"
                name="unlockDate"
                type="date"
                required
                min={unlockMin}
                aria-invalid={Boolean(state.fieldErrors?.unlockDate)}
                aria-describedby="unlock-date-error"
                className="mt-2 min-h-12 w-full rounded-xl border border-zinc-300 px-4 text-base outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
              />
              <FieldError id="unlock-date-error" errors={state.fieldErrors?.unlockDate} />
            </label>
          </div>
        </section>

        {state.formError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{state.formError}</p>}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full rounded-xl bg-amber-700 px-5 text-base font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create my goal"}
        </button>
      </form>
    </main>
  );
}
