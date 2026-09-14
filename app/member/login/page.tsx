import type { Metadata } from "next";

import { MemberLoginForm } from "./member-login-form";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export const metadata: Metadata = {
  title: "Circle member sign in · NIA",
  description: "Sign in to your SUSU circle with your Circle ID, member code, and PIN.",
};

export default async function MemberLoginPage() {
  const locale = await getLocale();
  return (
    <main className="min-h-screen bg-[#fbf7ef]">
      <MemberLoginForm locale={locale} dictionary={getDictionary(locale)} />
    </main>
  );
}
