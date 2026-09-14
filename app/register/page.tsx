import { redirect } from "next/navigation";

import RegisterForm from "@/app/register/register-form";
import { getVerifiedUser } from "@/src/auth/get-verified-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function RegisterPage() {
  const user = await getVerifiedUser();
  if (user) redirect("/dashboard");

  const locale = await getLocale();
  return <RegisterForm locale={locale} dictionary={getDictionary(locale)} />;
}
