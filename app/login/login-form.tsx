"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction } from "@/src/actions/auth.actions";
import { initialLoginState } from "@/src/actions/auth.state";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { localizeFieldError, localizeLoginError } from "@/src/i18n/auth-error-presentation";
import type { Locale } from "@/src/i18n/config";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export default function LoginForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [state, formAction, pending] = useActionState(loginAction, initialLoginState);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">{dictionary.login.title}</h1><LanguageSwitcher locale={locale} languageLabel={dictionary.common.language} compact /></div>
      <form action={formAction} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">{dictionary.common.email}</span>
          <input name="email" type="email" required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.email?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{localizeFieldError(error, dictionary)}</span>
          ))}
        </label>
        <label className="block">
          <span className="text-sm font-medium">{dictionary.common.password}</span>
          <input name="password" type="password" required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.password?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{localizeFieldError(error, dictionary)}</span>
          ))}
        </label>
        {state.formError && <p className="text-sm text-red-600">{localizeLoginError(dictionary)}</p>}
        <button type="submit" disabled={pending} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {pending ? dictionary.common.signingIn : dictionary.common.signIn}
        </button>
      </form>
      <p className="mt-4 text-sm">
        {dictionary.login.needAccount} <Link href="/register" className="underline">{dictionary.common.createAccount}</Link>
      </p>
      <section className="mt-8 rounded-xl border border-[#dfd2c1] bg-[#fffdf8] p-4 text-sm text-[#587066]">
        <h2 className="font-semibold text-[#173b32]">{dictionary.login.memberTitle}</h2>
        <p className="mt-1 leading-6">
          {dictionary.login.memberDescription}
        </p>
        <Link href="/member/login" className="mt-3 inline-flex font-semibold text-[#a95f45] underline">
          {dictionary.login.memberLink}
        </Link>
      </section>
    </main>
  );
}
