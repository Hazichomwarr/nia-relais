"use client";

import { useActionState } from "react";

import { updateDraftCircleConfigurationAction } from "@/src/actions/circle.actions";
import { initialUpdateDraftCircleConfigurationState } from "@/src/actions/circle.state";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import { getCurrencyDisplayCode, getFrequencyLabel } from "@/src/i18n/format";
import { DRAFT_CIRCLE_CURRENCIES, DRAFT_CIRCLE_FREQUENCIES } from "@/src/validations/circle.schema";
import type { DraftCircleOwnerCircleResult } from "@/src/services/circle-draft-owner.service";

const inputClassName = "mt-1.5 min-h-11 w-full rounded-xl border border-[#cdbda9] bg-white px-3 text-base text-[#173b32] outline-none focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30";

function FieldError({ errors }: { errors?: readonly string[] }) {
  return errors?.length ? <p role="alert" className="mt-1 text-sm text-[#b3261e]">{errors.join(" ")}</p> : null;
}

export function DraftCircleConfigurationForm({
  circle,
  dictionary,
  locale,
}: {
  circle: DraftCircleOwnerCircleResult;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.draftCircleConfiguration;
  const susu = dictionary.susu;
  const isImported = circle.originKind === "IMPORTED";
  const [state, formAction, pending] = useActionState(
    updateDraftCircleConfigurationAction,
    initialUpdateDraftCircleConfigurationState,
  );
  const formError = state.formError === "Circle details can only be changed while this new circle is still a draft."
    ? copy.draftOnlyError
    : state.formError === "We could not save these circle details. Please try again."
      ? copy.saveError
      : state.formError;

  return (
    <details className="mt-6 rounded-2xl border border-[#dfd2c1] bg-[#fffaf3] p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#7b8179]">{copy.details}</p>
      <summary className="cursor-pointer text-sm font-semibold text-[#173b32]">{copy.edit}</summary>
      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="circleId" value={circle.id} />
        {/* originKind is never user-editable here -- setup mode is chosen
            once, only at creation (9D.1 §2/§10). This hidden field only
            tells the action which validation branch applies; the service
            independently re-verifies it against the circle's own
            persisted, immutable origin and refuses any mismatch. */}
        <input type="hidden" name="originKind" value={circle.originKind} />
        <div>
          <label htmlFor="edit-circle-name" className="text-sm font-semibold text-[#173b32]">{susu.circleName}</label>
          <input id="edit-circle-name" name="name" required maxLength={100} defaultValue={circle.name} className={inputClassName} />
          <FieldError errors={state.fieldErrors?.name} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-circle-amount" className="text-sm font-semibold text-[#173b32]">{susu.contributionAmount}</label>
            <input id="edit-circle-amount" name="contributionAmount" required inputMode="decimal" defaultValue={circle.contributionAmount} className={inputClassName} />
            <FieldError errors={state.fieldErrors?.contributionAmount} />
          </div>
          <div>
            <label htmlFor="edit-circle-currency" className="text-sm font-semibold text-[#173b32]">{susu.currency}</label>
            <select id="edit-circle-currency" name="currency" defaultValue={circle.currency} className={inputClassName}>
              {DRAFT_CIRCLE_CURRENCIES.map((currency) => <option key={currency} value={currency}>{getCurrencyDisplayCode(currency)}</option>)}
            </select>
            <FieldError errors={state.fieldErrors?.currency} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-circle-frequency" className="text-sm font-semibold text-[#173b32]">{susu.frequency}</label>
            <select id="edit-circle-frequency" name="frequency" defaultValue={circle.frequency} className={inputClassName}>
              {DRAFT_CIRCLE_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{getFrequencyLabel(frequency, locale)}</option>)}
            </select>
            <FieldError errors={state.fieldErrors?.frequency} />
          </div>
          <div>
            <label htmlFor="edit-circle-start-date" className="text-sm font-semibold text-[#173b32]">{susu.startDate}</label>
            <input id="edit-circle-start-date" name="startDate" type="date" required defaultValue={circle.startDate} className={inputClassName} />
            {isImported ? <p className="mt-1.5 text-sm text-[#7b8179]">{susu.importedStartDateHelp}</p> : null}
            <FieldError errors={state.fieldErrors?.startDate} />
          </div>
        </div>
        {isImported ? (
          <>
            <div>
              <label htmlFor="edit-circle-historical-rounds" className="text-sm font-semibold text-[#173b32]">
                {susu.historicalCompletedRoundCount}
              </label>
              <p className="mt-1 text-sm text-[#7b8179]">{susu.historicalCompletedRoundCountHelp}</p>
              <input
                id="edit-circle-historical-rounds"
                name="historicalCompletedRoundCount"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                defaultValue={circle.historicalCompletedRoundCount}
                className={inputClassName}
              />
              <FieldError errors={state.fieldErrors?.historicalCompletedRoundCount} />
            </div>
            <div>
              <label className="flex items-start gap-2 text-sm text-[#173b32]">
                <input type="checkbox" name="historicalTermsConfirmed" required className="mt-0.5" />
                {susu.historicalTermsConfirmed}
              </label>
              <FieldError errors={state.fieldErrors?.historicalTermsConfirmed} />
            </div>
          </>
        ) : null}
        {state.status === "success" ? <p role="status" className="text-sm text-[#3f6b50]">{copy.saved}</p> : null}
        {formError ? <p role="alert" className="text-sm text-[#b3261e]">{formError}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className="min-h-11 rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white disabled:opacity-60">{pending ? copy.saving : copy.saveChanges}</button>
          <button type="reset" className="min-h-11 rounded-full border border-[#cdbda9] px-5 text-sm font-semibold text-[#173b32]">{copy.cancel}</button>
        </div>
      </form>
    </details>
  );
}
