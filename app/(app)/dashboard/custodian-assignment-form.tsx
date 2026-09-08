"use client";

import { useActionState } from "react";

import {
  createCustodianAssignmentAction,
  type CreateCustodianAssignmentActionState,
} from "@/src/actions/custodian.actions";

export function CustodianAssignmentForm({ goalId }: { goalId: string }) {
  const [state, formAction, pending] = useActionState<
    CreateCustodianAssignmentActionState,
    FormData
  >(createCustodianAssignmentAction, {});

  if (state.status === "success") {
    return (
      <div className="rounded-2xl bg-[#fbe1d1] p-4 text-sm leading-6 text-[#68483e]" role="status">
        Your request is on its way. They can now choose whether to accept.
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="goalId" value={goalId} />
      <label className="block" htmlFor={`custodian-email-${goalId}`}>
        <span className="text-sm font-semibold text-[#173b32]">Their NiaRelais email</span>
        <input
          id={`custodian-email-${goalId}`}
          name="custodianEmail"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          required
          aria-invalid={Boolean(state.fieldErrors?.custodianEmail || state.formError)}
          aria-describedby={`custodian-email-${goalId}-hint custodian-email-${goalId}-error`}
          className="mt-2 min-h-11 w-full rounded-2xl border border-[#c9c5b6] bg-[#fffdf7] px-4 text-base text-[#173c35] outline-none transition focus:border-[#b95035] focus:ring-4 focus:ring-[#f2c9af]"
          placeholder="name@example.com"
        />
      </label>
      <p id={`custodian-email-${goalId}-hint`} className="text-xs leading-5 text-[#7b8179]">
        They need an existing NiaRelais account to receive this request.
      </p>
      {state.fieldErrors?.custodianEmail?.map((error) => (
        <p key={error} id={`custodian-email-${goalId}-error`} className="text-sm text-[#a53f2b]" role="alert">
          {error}
        </p>
      ))}
      {state.formError ? (
        <p id={`custodian-email-${goalId}-error`} className="text-sm text-[#a53f2b]" role="alert">
          {state.formError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#b96549] px-4 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending request…" : "Ask them to be my custodian"}
      </button>
    </form>
  );
}
