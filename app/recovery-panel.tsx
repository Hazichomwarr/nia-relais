"use client";

import Link from "next/link";

type RecoveryPanelProps = {
  heading: string;
  description: string;
  retry: () => void;
  returnHref: string;
  returnLabel: string;
};

export function RecoveryPanel({
  heading,
  description,
  retry,
  returnHref,
  returnLabel,
}: RecoveryPanelProps) {
  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-[#fbf7ef] px-5 py-12 text-[#173b32] sm:px-8">
      <section className="w-full max-w-lg rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffaf2] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10" aria-live="polite">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">NIA</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-3 text-base leading-7 text-[#587066]">{description}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            Try again
          </button>
          <Link
            href={returnHref}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#cdbda9] bg-white px-5 text-sm font-semibold text-[#173b32] transition hover:bg-[#f6eee3] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            {returnLabel}
          </Link>
        </div>
      </section>
    </main>
  );
}
