import { LandingBenefits } from "@/components/marketing/landing-benefits";
import { LandingCta } from "@/components/marketing/landing-cta";
import { LandingHeader } from "@/components/marketing/landing-header";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingLanguageToggle } from "@/components/marketing/landing-language-toggle";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";

export default async function HomePage() {
  const locale = await getLocale();
  const dictionary = getDictionary(locale);

  return (
    <main className="min-h-screen overflow-hidden bg-[#fbf7ef] text-[#173b32]">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-12">
        <div className="pt-5 sm:pt-8">
          <LandingHeader locale={locale} dictionary={dictionary} />
          <div className="mt-4 flex justify-end sm:hidden"><LandingLanguageToggle locale={locale} /></div>
        </div>
        <LandingHero dictionary={dictionary} />
        <LandingBenefits dictionary={dictionary} />
        <LandingCta dictionary={dictionary} />
      </div>
    </main>
  );
}
