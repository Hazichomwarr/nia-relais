import { LandingBenefits } from "@/components/marketing/landing-benefits";
import { LandingCta } from "@/components/marketing/landing-cta";
import { LandingHeader } from "@/components/marketing/landing-header";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingLanguageToggle } from "@/components/marketing/landing-language-toggle";

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#fbf7ef] text-[#173b32]">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-12">
        <div className="pt-5 sm:pt-8">
          <LandingHeader />
          <div className="mt-4 flex justify-end sm:hidden">
            <LandingLanguageToggle />
          </div>
        </div>
        <LandingHero />
        <LandingBenefits />
        <LandingCta />
      </div>
    </main>
  );
}
