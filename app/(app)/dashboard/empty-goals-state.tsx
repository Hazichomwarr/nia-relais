import Link from "next/link";

export function EmptyGoalsState() {
  return (
    <section className="mt-12 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fff8ed] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">A place to begin</p>
      <h2 className="mt-4 max-w-md text-2xl font-semibold tracking-tight text-[#173b32] sm:text-3xl">
        You haven&apos;t started a goal yet.
      </h2>
      <p className="mt-3 max-w-md text-base leading-7 text-[#587066]">
        Give one of your dreams a place to grow.
      </p>
      <Link
        href="/goals/new"
        className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-[#b96549] px-5 font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
      >
        Create my first goal
      </Link>
    </section>
  );
}
