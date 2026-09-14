"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { addDraftCircleMemberAction } from "@/src/actions/circle.actions";
import { initialAddDraftCircleMemberState } from "@/src/actions/circle.state";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import { presentSusuDraftError } from "@/src/i18n/susu-draft-error-presentation";

// The raw PIN never comes back from the server -- addDraftCircleMember's
// own result type has no PIN field at all (only memberCode), and this
// component never attempts to reconstruct one from anything server-side.
// The PIN shown in the one-time handoff panel below is exactly the value
// this browser tab already had in memory from the moment the owner typed
// it, captured at the instant of submission (lastSubmittedPinRef) so a
// later successful response can be paired back up with the PIN that
// specific submission actually used. It is never written to
// localStorage/sessionStorage, never put in a URL, and disappears the
// moment this component's state is cleared (dismiss, navigate away, or a
// reload) -- there is no "reveal again" path, because there is nothing
// left anywhere to reveal.

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

type HandoffMember = { displayName: string; memberCode: string; pin: string };

export function AddMemberForm({ circleId, dictionary }: { circleId: string; dictionary: Dictionary }) {
  const copy = dictionary.susu;
  const [state, formAction, pending] = useActionState(addDraftCircleMemberAction, initialAddDraftCircleMemberState);
  const [pin, setPin] = useState("");
  const [handoff, setHandoff] = useState<HandoffMember | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSubmittedPinRef = useRef("");

  useEffect(() => {
    if (state.status === "success" && state.member) {
      setHandoff({
        displayName: state.member.displayName,
        memberCode: state.member.memberCode,
        pin: lastSubmittedPinRef.current,
      });
      lastSubmittedPinRef.current = "";
      setPin("");
      formRef.current?.reset();
    }
  }, [state]);

  if (handoff) {
    return (
      <div role="alert" className="rounded-2xl border border-[#e4b69c] bg-[#fbe1d1] p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#a53f2b]">{copy.credentialTitle}</p>
        <p className="mt-2 text-sm leading-6 text-[#68483e]">
          {copy.credentialDescription.replace("{name}", handoff.displayName)} <Link href="/member/login" className="font-semibold underline">{copy.memberSignIn}</Link>.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white/70 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#68483e]">{copy.credentialName}</dt>
            <dd className="mt-1 text-base font-semibold text-[#173b32]">{handoff.displayName}</dd>
          </div>
          <div className="rounded-xl bg-white/70 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#68483e]">{copy.credentialMemberCode}</dt>
            <dd className="mt-1 font-mono text-base font-semibold tracking-wide text-[#173b32]">{handoff.memberCode}</dd>
          </div>
          <div className="rounded-xl bg-white/70 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#68483e]">{copy.credentialPin}</dt>
            <dd className="mt-1 font-mono text-base font-semibold tracking-[0.3em] text-[#173b32]">{handoff.pin}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => setHandoff(null)}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
        >
          {copy.credentialDismiss}
        </button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={() => {
        lastSubmittedPinRef.current = pin;
      }}
      className="space-y-4"
    >
      <input type="hidden" name="circleId" value={circleId} />

      <p className="text-sm leading-6 text-[#587066]">
        {copy.addMemberDescription}
      </p>

      <div>
        <label htmlFor="displayName" className="block text-sm font-semibold text-[#173b32]">
          {copy.memberName}
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          maxLength={100}
          placeholder={copy.memberNamePlaceholder}
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
          aria-describedby="displayName-error"
          className={inputClassName}
        />
        <FieldError id="displayName-error" errors={state.fieldErrors?.displayName} />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-[#173b32]">
          {dictionary.common.email} <span className="font-normal text-[#7b8179]">({copy.optional})</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          placeholder="name@example.com"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby="email-error"
          className={inputClassName}
        />
        <FieldError id="email-error" errors={state.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="pin" className="block text-sm font-semibold text-[#173b32]">
          {copy.memberPin}
        </label>
        <p id="pin-hint" className="mt-1 text-xs text-[#7b8179]">
          {copy.memberPinHint}
        </p>
        <input
          id="pin"
          name="pin"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          aria-invalid={Boolean(state.fieldErrors?.pin)}
          aria-describedby="pin-hint pin-error"
          className={`${inputClassName} tracking-[0.3em]`}
        />
        <FieldError id="pin-error" errors={state.fieldErrors?.pin} />
      </div>

      {state.formError ? (
        <p role="alert" className="text-sm font-medium text-[#b3261e]">
          {presentSusuDraftError(state.formError, copy)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? copy.addingMember : copy.addMember}
      </button>
    </form>
  );
}
