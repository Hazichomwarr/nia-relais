"use client";

import { useActionState } from "react";

import {
  registerAction,
} from "@/src/actions/auth.actions";
import { initialRegistrationState } from "@/src/actions/auth.state";

export default function RegisterForm() {
  const [state, formAction, pending] = useActionState(
    registerAction,
    initialRegistrationState,
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold">Create your NIA account</h1>
      <form action={formAction} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.name?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{error}</span>
          ))}
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input name="email" type="email" required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.email?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{error}</span>
          ))}
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input name="password" type="password" minLength={8} required className="mt-1 w-full rounded border px-3 py-2" />
          {state.fieldErrors?.password?.map((error) => (
            <span key={error} className="mt-1 block text-sm text-red-600">{error}</span>
          ))}
        </label>
        {state.formError && <p className="text-sm text-red-600">{state.formError}</p>}
        <button type="submit" disabled={pending} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
