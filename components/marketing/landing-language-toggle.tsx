import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/src/i18n/config";

export function LandingLanguageToggle({ locale }: { locale: Locale }) {
  return <LanguageSwitcher locale={locale} compact />;
}
