"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  buildMemberCircleHref,
  buildMemberLoginRequestPayload,
  GENERIC_MEMBER_AUTH_ERROR,
  MEMBER_AUTH_NETWORK_ERROR,
  type MemberLoginFieldErrors,
  validateMemberLoginForm,
} from "./member-login-form.logic";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/src/i18n/config";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

// Nothing in this file reads document.cookie, localStorage, or
// sessionStorage, and nothing here ever inspects a Set-Cookie header or a
// response body for a session token -- the browser attaches and stores the
// nia_member_session cookie entirely on its own from the fetch response,
// outside of anything this script can see. See
// docs/security/member-login-orchestration.md.

type FieldName = "circleCode" | "memberCode" | "pin";

export function MemberLoginForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const router = useRouter();

  const [circleCode, setCircleCode] = useState("");
  const [memberCode, setMemberCode] = useState("");
  const [pin, setPin] = useState("");
  const [fieldErrors, setFieldErrors] = useState<MemberLoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // A second, synchronous guard alongside `isSubmitting` state: React state
  // updates are not guaranteed to have flushed before a fast second Enter
  // keypress re-enters this handler, but a ref update is immediate.
  const isSubmittingRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    const values = { circleCode, memberCode, pin };
    const errors = validateMemberLoginForm(values);
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const payload = buildMemberLoginRequestPayload(values);

    try {
      const response = await fetch("/api/member/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      let resolvedCircleId: string | null = null;
      try {
        const data: unknown = await response.json();
        const authenticated =
          response.ok &&
          typeof data === "object" &&
          data !== null &&
          (data as { ok?: unknown }).ok === true;
        const circleId = authenticated ? (data as { circleId?: unknown }).circleId : null;
        resolvedCircleId = typeof circleId === "string" && circleId.length > 0 ? circleId : null;
      } catch {
        resolvedCircleId = null;
      }

      if (!resolvedCircleId) {
        setFormError(GENERIC_MEMBER_AUTH_ERROR);
        setIsSubmitting(false);
        isSubmittingRef.current = false;
        return;
      }

      // Navigating away -- deliberately leave isSubmitting/isSubmittingRef
      // as-is. This screen is about to unmount; there is no button left to
      // double-submit with, so there is nothing to reset.
      router.push(buildMemberCircleHref(resolvedCircleId));
    } catch {
      setFormError(MEMBER_AUTH_NETWORK_ERROR);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }

  function describedBy(field: FieldName): string | undefined {
    const ids = [`${field}-hint`, fieldErrors[field] ? `${field}-error` : null].filter(Boolean);
    return ids.length > 0 ? ids.join(" ") : undefined;
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-md flex-col justify-center px-5 py-10 sm:px-0">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a95f45]">
        {dictionary.memberLogin.eyebrow}
      </p>
      <div className="mt-3 flex items-start justify-between gap-4"><h1 className="font-serif text-4xl leading-tight tracking-[-0.02em] text-[#173b32] sm:text-5xl">{dictionary.memberLogin.title}</h1><LanguageSwitcher locale={locale} languageLabel={dictionary.common.language} compact /></div>
      <p className="mt-4 text-base leading-7 text-[#587066]">
        {dictionary.memberLogin.description}
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isSubmitting}
        className="mt-8 space-y-5 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8"
      >
        <div>
          <label htmlFor="circleCode" className="block text-sm font-semibold text-[#173b32]">
            {dictionary.memberLogin.circleCode}
          </label>
          <p id="circleCode-hint" className="mt-1 text-xs text-[#7b8179]">
            {dictionary.memberLogin.circleCodeHint}
          </p>
          <input
            id="circleCode"
            name="circleCode"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            value={circleCode}
            onChange={(event) => setCircleCode(event.target.value)}
            aria-invalid={Boolean(fieldErrors.circleCode)}
            aria-describedby={describedBy("circleCode")}
            disabled={isSubmitting}
            className="mt-2 block w-full rounded-xl border border-[#cdbda9] bg-white px-3.5 py-2.5 text-base uppercase tracking-wider text-[#173b32] outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30 disabled:opacity-60"
          />
          {fieldErrors.circleCode ? (
            <p id="circleCode-error" role="alert" className="mt-1.5 text-sm text-[#b3261e]">
              {localizeMemberFieldError(fieldErrors.circleCode, dictionary)}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="memberCode" className="block text-sm font-semibold text-[#173b32]">
            {dictionary.memberLogin.memberCode}
          </label>
          <p id="memberCode-hint" className="mt-1 text-xs text-[#7b8179]">
            {dictionary.memberLogin.memberCodeHint}
          </p>
          <input
            id="memberCode"
            name="memberCode"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            value={memberCode}
            onChange={(event) => setMemberCode(event.target.value)}
            aria-invalid={Boolean(fieldErrors.memberCode)}
            aria-describedby={describedBy("memberCode")}
            disabled={isSubmitting}
            className="mt-2 block w-full rounded-xl border border-[#cdbda9] bg-white px-3.5 py-2.5 text-base uppercase tracking-wider text-[#173b32] outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30 disabled:opacity-60"
          />
          {fieldErrors.memberCode ? (
            <p id="memberCode-error" role="alert" className="mt-1.5 text-sm text-[#b3261e]">
              {localizeMemberFieldError(fieldErrors.memberCode, dictionary)}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="pin" className="block text-sm font-semibold text-[#173b32]">
            {dictionary.memberLogin.pin}
          </label>
          <p id="pin-hint" className="mt-1 text-xs text-[#7b8179]">
            {dictionary.memberLogin.pinHint}
          </p>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            required
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={Boolean(fieldErrors.pin)}
            aria-describedby={describedBy("pin")}
            disabled={isSubmitting}
            className="mt-2 block w-full rounded-xl border border-[#cdbda9] bg-white px-3.5 py-2.5 text-base tracking-[0.3em] text-[#173b32] outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30 disabled:opacity-60"
          />
          {fieldErrors.pin ? (
            <p id="pin-error" role="alert" className="mt-1.5 text-sm text-[#b3261e]">
              {localizeMemberFieldError(fieldErrors.pin, dictionary)}
            </p>
          ) : null}
        </div>

        {formError ? (
          <p role="alert" aria-live="assertive" className="text-sm font-medium text-[#b3261e]">
          {localizeMemberFormError(formError, dictionary)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#b96549] px-6 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(185,101,73,0.22)] transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? dictionary.common.signingIn : dictionary.common.signIn}
        </button>
      </form>
    </div>
  );
}

function localizeMemberFieldError(error: string, dictionary: Dictionary) {
  if (error === "Enter your Circle Code.") return dictionary.memberLogin.fieldCircleCode;
  if (error === "Enter the member code exactly as given to you.") return dictionary.memberLogin.fieldMemberCode;
  if (error === "Enter your 6-digit PIN.") return dictionary.memberLogin.fieldPin;
  return error;
}

function localizeMemberFormError(error: string, dictionary: Dictionary) {
  if (error === GENERIC_MEMBER_AUTH_ERROR) return dictionary.memberLogin.genericError;
  if (error === MEMBER_AUTH_NETWORK_ERROR) return dictionary.memberLogin.networkError;
  return error;
}
