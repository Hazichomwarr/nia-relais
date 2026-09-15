import Link from "next/link";

import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function EmptyGoalsState({ dictionary }: { dictionary: Dictionary }) {
  const copy = dictionary.dashboard;

  return (
    <section className="mt-12 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fff8ed] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{copy.emptySavingsTitle}</p>
      <h2 className="mt-4 max-w-md text-2xl font-semibold tracking-tight text-[#173b32] sm:text-3xl">
        {copy.noGoalsYet}
      </h2>
      <p className="mt-3 max-w-md text-base leading-7 text-[#587066]">
        {copy.emptySavingsDescription}
      </p>
      <Link
        href="/goals/new"
        className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-[#b96549] px-5 font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
      >
        {copy.createFirstGoal}
      </Link>
    </section>
  );
}
