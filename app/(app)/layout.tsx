import { requireUser } from "@/src/auth/require-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

import { AppNavigation } from "./app-navigation";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);

  return (
    <div className="min-h-[100dvh] bg-[var(--nia-app-background)] text-[var(--nia-text)]">
      <AppNavigation userName={user.name} locale={locale} dictionary={getDictionary(locale)} />
      <main>{children}</main>
    </div>
  );
}
