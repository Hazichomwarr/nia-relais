import type { Metadata } from "next";

import { MemberLoginForm } from "./member-login-form";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const dictionary = getDictionary(await getLocale());
  return { title: `${dictionary.memberLogin.eyebrow} · NIA`, description: dictionary.memberLogin.description };
}

export default async function MemberLoginPage() {
  const locale = await getLocale();
  return (
    <main className="min-h-screen bg-[#fbf7ef]">
      <MemberLoginForm locale={locale} dictionary={getDictionary(locale)} />
    </main>
  );
}
