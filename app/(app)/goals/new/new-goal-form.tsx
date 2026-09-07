"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";

import {
  createPersonalGoalAction,
  type CreatePersonalGoalActionState,
} from "@/src/actions/goal.actions";
import { initialCreatePersonalGoalState } from "@/src/actions/goal.state";

const currencies = ["USD", "XOF", "EUR", "GBP"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (/^0*$/.test(`${whole}${fraction}`)) return null;
  return BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

function calculateTimeline(targetAmount: string, weeklyAmount: string, startDate: string) {
  const targetCents = toCents(targetAmount);
  const weeklyCents = toCents(weeklyAmount);
  const today = todayDate();
  if (!targetCents || !weeklyCents || !isValidDateOnly(startDate) || startDate > today) return null;

  const [year, month, day] = startDate.split("-").map(Number);
  const startTimestamp = BigInt(Date.UTC(year, month - 1, day));
  const weeksNeeded = (targetCents + weeklyCents - BigInt(1)) / weeklyCents;
  const unlockTimestamp = startTimestamp + weeksNeeded * BigInt(7 * DAY_MS);
  const maximumDateMilliseconds = BigInt(8640000000000000);
  if (unlockTimestamp > maximumDateMilliseconds || unlockTimestamp < -maximumDateMilliseconds) return null;

  const unlockDate = new Date(Number(unlockTimestamp));
  return {
    weeks: weeksNeeded.toString(),
    displayDate: new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(unlockDate),
  };
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;

  return <p id={id} className="mt-1 text-sm text-[#a53f2b]" role="alert">{errors.join(" ")}</p>;
}

const inputClassName = "mt-2 min-h-12 w-full rounded-2xl border border-[#c9c5b6] bg-[#fffdf7] px-4 text-base text-[#173c35] outline-none transition focus:border-[#b95035] focus:ring-4 focus:ring-[#f2c9af]";

export default function NewGoalForm() {
  const [state, formAction, pending] = useActionState<CreatePersonalGoalActionState, FormData>(createPersonalGoalAction, initialCreatePersonalGoalState);
  const [targetAmount, setTargetAmount] = useState("");
  const [weeklyAmount, setWeeklyAmount] = useState("");
  const [currency, setCurrency] = useState<(typeof currencies)[number]>("USD");
  const [startDate, setStartDate] = useState(todayDate);
  const today = todayDate();
  const timeline = useMemo(() => calculateTimeline(targetAmount, weeklyAmount, startDate), [targetAmount, weeklyAmount, startDate]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f8f1e4] px-4 py-8 text-[#173c35] sm:px-8 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <header className="rounded-[2rem] bg-[#173c35] px-6 py-8 text-[#fffaf0] shadow-[0_18px_45px_rgba(23,60,53,0.16)] sm:px-10 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#f2c9af]">Personal savings</p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">Build something worth waiting for.</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#dce7dd]">Give your dream a place to grow with a clear target and a weekly promise to yourself.</p>
        </header>

        <form action={formAction} className="mt-6 space-y-5">
          <section className="rounded-[2rem] bg-[#fffaf0] p-6 shadow-[0_12px_30px_rgba(23,60,53,0.08)] sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b95035]">01 · Name the dream</p>
            <h2 className="mt-2 text-2xl font-semibold">What are you saving for?</h2>
            <p className="mt-2 text-sm leading-6 text-[#5a6b61]">Choose a name that will make this goal feel personal when you return to it.</p>
            <label className="mt-6 block" htmlFor="goal-name">
              <span className="text-sm font-semibold">Goal name</span>
              <input id="goal-name" name="name" required maxLength={100} aria-invalid={Boolean(state.fieldErrors?.name)} aria-describedby="goal-name-error" className={inputClassName} placeholder="A name with meaning" />
              <FieldError id="goal-name-error" errors={state.fieldErrors?.name} />
            </label>
          </section>

          <section className="rounded-[2rem] bg-[#fffaf0] p-6 shadow-[0_12px_30px_rgba(23,60,53,0.08)] sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b95035]">02 · Choose the destination</p>
            <h2 className="mt-2 text-2xl font-semibold">How much do you want to reach?</h2>
            <p className="mt-2 text-sm leading-6 text-[#5a6b61]">Your target is the finish line. We will help you turn it into a steady rhythm.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block" htmlFor="target-amount">
                <span className="text-sm font-semibold">Target amount</span>
                <input id="target-amount" name="targetAmount" type="text" inputMode="decimal" required value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} placeholder="0.00" aria-invalid={Boolean(state.fieldErrors?.targetAmount)} aria-describedby="target-amount-error" className={inputClassName} />
                <FieldError id="target-amount-error" errors={state.fieldErrors?.targetAmount} />
              </label>
              <label className="block" htmlFor="currency">
                <span className="text-sm font-semibold">Currency</span>
                <select id="currency" name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as (typeof currencies)[number])} aria-invalid={Boolean(state.fieldErrors?.currency)} aria-describedby="currency-error" className={inputClassName}>
                  {currencies.map((option) => <option key={option}>{option}</option>)}
                </select>
                <FieldError id="currency-error" errors={state.fieldErrors?.currency} />
              </label>
            </div>
          </section>

          <section className="rounded-[2rem] bg-[#fffaf0] p-6 shadow-[0_12px_30px_rgba(23,60,53,0.08)] sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b95035]">03 · Make it steady</p>
            <h2 className="mt-2 text-2xl font-semibold">What can you commit each week?</h2>
            <p className="mt-2 text-sm leading-6 text-[#5a6b61]">Small, consistent steps are how meaningful goals become real.</p>
            <label className="mt-6 block" htmlFor="weekly-amount">
              <span className="text-sm font-semibold">Weekly commitment</span>
              <input id="weekly-amount" name="weeklyAmount" type="text" inputMode="decimal" required value={weeklyAmount} onChange={(event) => setWeeklyAmount(event.target.value)} placeholder="0.00" aria-invalid={Boolean(state.fieldErrors?.weeklyAmount)} aria-describedby="weekly-amount-error" className={inputClassName} />
              <FieldError id="weekly-amount-error" errors={state.fieldErrors?.weeklyAmount} />
            </label>
          </section>

          <section className="rounded-[2rem] bg-[#fffaf0] p-6 shadow-[0_12px_30px_rgba(23,60,53,0.08)] sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b95035]">04 · Begin</p>
            <h2 className="mt-2 text-2xl font-semibold">When will you start?</h2>
            <p className="mt-2 text-sm leading-6 text-[#5a6b61]">Pick a day that feels practical. Your unlock date will be worked out from this beginning.</p>
            <label className="mt-6 block" htmlFor="start-date">
              <span className="text-sm font-semibold">Start date</span>
              <input id="start-date" name="startDate" type="date" required max={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-invalid={Boolean(state.fieldErrors?.startDate)} aria-describedby="start-date-error" className={inputClassName} />
              <FieldError id="start-date-error" errors={state.fieldErrors?.startDate} />
            </label>
          </section>

          <section className="rounded-[2rem] border border-[#e4b69c] bg-[#fbe1d1] p-6 sm:p-8" aria-live="polite">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#a53f2b]">Your timeline</p>
            <h2 className="mt-2 text-2xl font-semibold">A date to look forward to.</h2>
            <p className="mt-2 text-sm leading-6 text-[#68483e]">Your unlock date is calculated automatically from your target and weekly commitment.</p>
            {timeline ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#fffaf0]/75 p-5"><p className="text-sm text-[#68483e]">Estimated rhythm</p><p className="mt-1 text-3xl font-semibold">{timeline.weeks} <span className="text-base font-medium">weeks</span></p></div>
                <div className="rounded-2xl bg-[#fffaf0]/75 p-5"><p className="text-sm text-[#68483e]">Unlock date</p><p className="mt-1 text-xl font-semibold">{timeline.displayDate}</p></div>
              </div>
            ) : (
              <p className="mt-6 rounded-2xl bg-[#fffaf0]/75 p-5 text-sm text-[#68483e]">Add a valid target, weekly commitment, and start date to see your timeline.</p>
            )}
            {timeline && <p className="mt-4 text-sm leading-6 text-[#68483e]">Based on your {currency} {weeklyAmount} weekly commitment. Saving extra may help you reach the amount sooner, but your commitment remains locked until this date.</p>}
          </section>

          {state.formError && <p className="rounded-2xl bg-[#f8d8d0] p-4 text-sm text-[#8d2f20]" role="alert">{state.formError}</p>}
          <button type="submit" disabled={pending} className="min-h-14 w-full rounded-2xl bg-[#b95035] px-5 text-base font-semibold text-white shadow-[0_10px_22px_rgba(185,80,53,0.22)] transition hover:bg-[#a53f2b] focus:outline-none focus:ring-4 focus:ring-[#f2c9af] disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? "Creating your goal…" : "Create my goal"}
          </button>
        </form>
      </div>
    </main>
  );
}
