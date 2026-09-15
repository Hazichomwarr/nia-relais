import Image from "next/image";
import Link from "next/link";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function LandingHero({ dictionary }: { dictionary: Dictionary }) {
  return (
    <section className="grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:py-20">
      <div className="max-w-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#a95f45]">
          {dictionary.landing.eyebrow}
        </p>

        <h1 className="mt-5 font-serif text-[clamp(3.5rem,10vw,6.5rem)] leading-[0.9] tracking-[-0.055em] text-[#173b32]">
          <span className="block">{dictionary.landing.titleFirst}</span>
          <span className="mt-2 block text-[#b96549]">{dictionary.landing.titleSecond}</span>
        </h1>

        <p className="mt-8 max-w-md text-lg leading-8 text-[#587066] sm:text-xl">
          {dictionary.landing.description}
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/register"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#b96549] px-6 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(185,101,73,0.22)] transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            {dictionary.landing.startSaving}
          </Link>

          <Link
            href="/login"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#cdbda9] px-6 text-sm font-semibold text-[#173b32] transition hover:bg-[#fffaf2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            {dictionary.landing.existingAccount}
          </Link>
        </div>

        <p className="mt-6 max-w-sm text-xs leading-5 text-[#7b8179]">
          {dictionary.landing.trustNote}
        </p>
      </div>

      <div className="relative mx-auto w-full max-w-[38rem]">
        <Image
          src="/images/nia-hero.png"
          alt={dictionary.landing.heroImageAlt}
          width={900}
          height={900}
          priority
          className="h-auto w-full object-contain"
          sizes="(max-width: 1024px) 90vw, 42vw"
        />
      </div>
    </section>
  );
}
