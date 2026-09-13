import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fbf7ef] px-5 py-12 text-[#173b32] sm:px-8">
      <section className="w-full max-w-lg rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffaf2] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">NIA</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">We couldn’t find that page.</h1>
        <p className="mt-3 text-base leading-7 text-[#587066]">It may no longer be available, or the link may be incorrect.</p>
        <Link
          href="/"
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
        >
          Return home
        </Link>
      </section>
    </main>
  );
}
