"use client";

import { useActionState } from "react";

import {
  registerAction,
} from "@/src/actions/auth.actions";
import { initialRegistrationState } from "@/src/actions/auth.state";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { localizeFieldError, localizeRegistrationError } from "@/src/i18n/auth-error-presentation";
import type { Locale } from "@/src/i18n/config";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export default function RegisterForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [state, formAction, pending] = useActionState(
    registerAction,
    initialRegistrationState,
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">{dictionary.register.title}</h1><LanguageSwitcher locale={locale} compact /></div>
      <form action={formAction} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">{dictionary.common.name}</span>
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.name?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{localizeFieldError(error, dictionary)}</span>
          ))}
        </label>
        <label className="block">
          <span className="text-sm font-medium">{dictionary.common.email}</span>
          <input name="email" type="email" required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.email?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{localizeFieldError(error, dictionary)}</span>
          ))}
        </label>
        <label className="block">
          <span className="text-sm font-medium">{dictionary.common.password}</span>
          <input name="password" type="password" minLength={8} required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.password?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{localizeFieldError(error, dictionary)}</span>
          ))}
        </label>
        {state.formError && <p className="text-sm text-red-600">{localizeRegistrationError(state.formError, dictionary)}</p>}
        <button type="submit" disabled={pending} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {pending ? dictionary.common.creatingAccount : dictionary.common.createAccount}
        </button>
      </form>
    </main>
  );
}
