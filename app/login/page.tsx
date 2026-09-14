import { redirect } from "next/navigation";

import LoginForm from "@/app/login/login-form";
import { getVerifiedUser } from "@/src/auth/get-verified-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function LoginPage() {
  const user = await getVerifiedUser();
  if (user) redirect("/dashboard");

  const locale = await getLocale();
  return <LoginForm locale={locale} dictionary={getDictionary(locale)} />;
}
