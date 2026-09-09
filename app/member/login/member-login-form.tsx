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

// Nothing in this file reads document.cookie, localStorage, or
// sessionStorage, and nothing here ever inspects a Set-Cookie header or a
// response body for a session token -- the browser attaches and stores the
// nia_member_session cookie entirely on its own from the fetch response,
// outside of anything this script can see. See
// docs/security/member-login-orchestration.md.

type FieldName = "circleId" | "memberCode" | "pin";

export function MemberLoginForm() {
  const router = useRouter();

  const [circleId, setCircleId] = useState("");
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

    const values = { circleId, memberCode, pin };
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

      let authenticated = false;
      try {
        const data: unknown = await response.json();
        authenticated =
          response.ok &&
          typeof data === "object" &&
          data !== null &&
          (data as { ok?: unknown }).ok === true;
      } catch {
        authenticated = false;
      }

      if (!authenticated) {
        setFormError(GENERIC_MEMBER_AUTH_ERROR);
        setIsSubmitting(false);
        isSubmittingRef.current = false;
        return;
      }

      // Navigating away -- deliberately leave isSubmitting/isSubmittingRef
      // as-is. This screen is about to unmount; there is no button left to
      // double-submit with, so there is nothing to reset.
      router.push(buildMemberCircleHref(payload.circleId));
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
        SUSU circle member sign in
      </p>
      <h1 className="mt-3 font-serif text-4xl leading-tight tracking-[-0.02em] text-[#173b32] sm:text-5xl">
        Welcome back
      </h1>
      <p className="mt-4 text-base leading-7 text-[#587066]">
        Enter the details your circle organizer gave you to view your circle.
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isSubmitting}
        className="mt-8 space-y-5 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8"
      >
        <div>
          <label htmlFor="circleId" className="block text-sm font-semibold text-[#173b32]">
            Circle ID
          </label>
          <p id="circleId-hint" className="mt-1 text-xs text-[#7b8179]">
            Ask your circle organizer for this.
          </p>
          <input
            id="circleId"
            name="circleId"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={circleId}
            onChange={(event) => setCircleId(event.target.value)}
            aria-invalid={Boolean(fieldErrors.circleId)}
            aria-describedby={describedBy("circleId")}
            disabled={isSubmitting}
            className="mt-2 block w-full rounded-xl border border-[#cdbda9] bg-white px-3.5 py-2.5 text-base text-[#173b32] outline-none transition focus-visible:border-[#b96549] focus-visible:ring-2 focus-visible:ring-[#b96549]/30 disabled:opacity-60"
          />
          {fieldErrors.circleId ? (
            <p id="circleId-error" role="alert" className="mt-1.5 text-sm text-[#b3261e]">
              {fieldErrors.circleId}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="memberCode" className="block text-sm font-semibold text-[#173b32]">
            Member code
          </label>
          <p id="memberCode-hint" className="mt-1 text-xs text-[#7b8179]">
            The 16-character code from your circle invitation.
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
              {fieldErrors.memberCode}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="pin" className="block text-sm font-semibold text-[#173b32]">
            PIN
          </label>
          <p id="pin-hint" className="mt-1 text-xs text-[#7b8179]">
            Your 6-digit PIN.
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
              {fieldErrors.pin}
            </p>
          ) : null}
        </div>

        {formError ? (
          <p role="alert" aria-live="assertive" className="text-sm font-medium text-[#b3261e]">
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#b96549] px-6 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(185,101,73,0.22)] transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
