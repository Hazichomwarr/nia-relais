import Link from "next/link";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function LandingCta({ dictionary }: { dictionary: Dictionary }) {
  return (
    <section className="flex flex-col gap-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-12">
      <div>
        <p className="font-serif text-2xl text-[#173b32] sm:text-3xl">{dictionary.landing.ctaTitle}</p>
        <p className="mt-2 text-sm text-[#587066]">{dictionary.landing.ctaDescription}</p>
      </div>
      <Link href="/register" className="inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-[#173b32] px-6 text-sm font-semibold text-[#fffaf2] transition hover:bg-[#28564a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]">
        {dictionary.landing.startSaving}
      </Link>
    </section>
  );
}
