"use client";

import { useActionState, useState } from "react";

import { createDraftCircleAction } from "@/src/actions/circle.actions";
import { initialCreateDraftCircleState } from "@/src/actions/circle.state";
import { CIRCLE_ORIGIN_KINDS, DRAFT_CIRCLE_CURRENCIES, DRAFT_CIRCLE_FREQUENCIES } from "@/src/validations/circle.schema";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import { getCurrencyDisplayCode, getFrequencyLabel as getLocalizedFrequencyLabel } from "@/src/i18n/format";

import { buildContributionRestatement } from "./new-circle-form-display";

// This form reads only the five fields runCreateDraftCircleAction actually
// consumes -- circle name, currency, contribution amount, frequency, start
// date. There is no ownerId, status, activation, or memberId field
// anywhere in this component: ownerId is derived server-side from
// requireUser() inside the action, never supplied by this form.

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-[#b3261e]">
      {errors.join(" ")}
    </p>
  );
}

const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-[#cdbda9] bg-white px-3.5 text-base text-[#173b32] outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30";

export function NewCircleForm({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.susu;
  const [state, formAction, pending] = useActionState(createDraftCircleAction, initialCreateDraftCircleState);
  const [currency, setCurrency] = useState<(typeof DRAFT_CIRCLE_CURRENCIES)[number]>(DRAFT_CIRCLE_CURRENCIES[0]);
  const [contributionAmount, setContributionAmount] = useState("");
  const [frequency, setFrequency] = useState<(typeof DRAFT_CIRCLE_FREQUENCIES)[number]>(DRAFT_CIRCLE_FREQUENCIES[2]);
  const [originKind, setOriginKind] = useState<(typeof CIRCLE_ORIGIN_KINDS)[number]>("NEW");
  const today = todayDate();
  const isImported = originKind === "IMPORTED";

  const restatement = buildContributionRestatement({ contributionAmount, currency, frequency });

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-0">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{copy.eyebrow}</p><h1 className="mt-3 font-serif text-3xl tracking-tight text-[#173b32] sm:text-4xl">{copy.newTitle}</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-[#587066]">
        {copy.newDescription}
      </p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#7b8179]">
        {copy.ledgerDescription}
      </p>

      <form
        action={formAction}
        className="mt-8 space-y-5 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8"
      >
        <fieldset>
          <legend className="block text-sm font-semibold text-[#173b32]">{copy.setupModeQuestion}</legend>
          <div className="mt-2 space-y-2">
            {CIRCLE_ORIGIN_KINDS.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-[#173b32]">
                <input
                  type="radio"
                  name="originKind"
                  value={option}
                  checked={originKind === option}
                  onChange={() => setOriginKind(option)}
                />
                {option === "NEW" ? copy.setupModeNew : copy.setupModeImported}
              </label>
            ))}
          </div>
          <FieldError id="originKind-error" errors={state.fieldErrors?.originKind} />
        </fieldset>

        <div>
          <label htmlFor="name" className="block text-sm font-semibold text-[#173b32]">
            {copy.circleName}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={100}
            placeholder={copy.circleNamePlaceholder}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby="name-error"
            className={inputClassName}
          />
          <FieldError id="name-error" errors={state.fieldErrors?.name} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contributionAmount" className="block text-sm font-semibold text-[#173b32]">
              {copy.contributionAmount}
            </label>
            <input
              id="contributionAmount"
              name="contributionAmount"
              type="text"
              inputMode="decimal"
              required
              value={contributionAmount}
              onChange={(event) => setContributionAmount(event.target.value)}
              placeholder="0.00"
              aria-invalid={Boolean(state.fieldErrors?.contributionAmount)}
              aria-describedby="contributionAmount-error"
              className={inputClassName}
            />
            <FieldError id="contributionAmount-error" errors={state.fieldErrors?.contributionAmount} />
          </div>

          <div>
            <label htmlFor="currency" className="block text-sm font-semibold text-[#173b32]">
              {copy.currency}
            </label>
            <select
              id="currency"
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as (typeof DRAFT_CIRCLE_CURRENCIES)[number])}
              aria-invalid={Boolean(state.fieldErrors?.currency)}
              aria-describedby="currency-error"
              className={inputClassName}
            >
              {DRAFT_CIRCLE_CURRENCIES.map((option) => (
                <option key={option} value={option}>
                  {getCurrencyDisplayCode(option)}
                </option>
              ))}
            </select>
            <FieldError id="currency-error" errors={state.fieldErrors?.currency} />
          </div>
        </div>

        <div>
          <label htmlFor="frequency" className="block text-sm font-semibold text-[#173b32]">
            {copy.frequency}
          </label>
          <select
            id="frequency"
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as (typeof DRAFT_CIRCLE_FREQUENCIES)[number])}
            aria-invalid={Boolean(state.fieldErrors?.frequency)}
            aria-describedby="frequency-error"
            className={inputClassName}
          >
            {DRAFT_CIRCLE_FREQUENCIES.map((option) => (
              <option key={option} value={option}>
                {getLocalizedFrequencyLabel(option, locale)}
              </option>
            ))}
          </select>
          <FieldError id="frequency-error" errors={state.fieldErrors?.frequency} />
        </div>

        <div>
          <label htmlFor="startDate" className="block text-sm font-semibold text-[#173b32]">
            {copy.startDate}
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            required
            min={isImported ? undefined : today}
            defaultValue={today}
            aria-invalid={Boolean(state.fieldErrors?.startDate)}
            aria-describedby="startDate-error"
            className={inputClassName}
          />
          {isImported ? <p className="mt-1.5 text-sm text-[#7b8179]">{copy.importedStartDateHelp}</p> : null}
          <FieldError id="startDate-error" errors={state.fieldErrors?.startDate} />
        </div>

        {isImported ? (
          <>
            <div>
              <label htmlFor="historicalCompletedRoundCount" className="block text-sm font-semibold text-[#173b32]">
                {copy.historicalCompletedRoundCount}
              </label>
              <p className="mt-1 text-sm text-[#7b8179]">{copy.historicalCompletedRoundCountHelp}</p>
              <input
                id="historicalCompletedRoundCount"
                name="historicalCompletedRoundCount"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                aria-invalid={Boolean(state.fieldErrors?.historicalCompletedRoundCount)}
                aria-describedby="historicalCompletedRoundCount-error"
                className={inputClassName}
              />
              <FieldError id="historicalCompletedRoundCount-error" errors={state.fieldErrors?.historicalCompletedRoundCount} />
            </div>

            <div>
              <label className="flex items-start gap-2 text-sm text-[#173b32]">
                <input type="checkbox" name="historicalTermsConfirmed" required className="mt-0.5" />
                {copy.historicalTermsConfirmed}
              </label>
              <FieldError id="historicalTermsConfirmed-error" errors={state.fieldErrors?.historicalTermsConfirmed} />
            </div>
          </>
        ) : null}

        {restatement ? (
          <p role="status" className="rounded-2xl bg-[#f7eee4] p-4 text-sm leading-6 text-[#587066]">
            {restatement}
          </p>
        ) : null}

        {state.formError ? (
          <p role="alert" className="text-sm font-medium text-[#b3261e]">
            {state.formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#b96549] px-6 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(185,101,73,0.22)] transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? copy.creating : copy.create}
        </button>
      </form>
    </div>
  );
}
