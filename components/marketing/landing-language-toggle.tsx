import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/src/i18n/config";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function LandingLanguageToggle({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  return <LanguageSwitcher locale={locale} languageLabel={dictionary.common.language} compact />;
}
