import Link from "next/link";

export function LandingHero() {
  return (
    <section className="grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:py-20">
      <div className="max-w-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#a95f45]">
          A softer way to save
        </p>
        <h1 className="mt-5 font-serif text-[clamp(3.5rem,10vw,6.5rem)] leading-[0.9] tracking-[-0.055em] text-[#173b32]">
          <span className="block">Small steps.</span>
          <span className="mt-2 block text-[#b96549]">Brighter tomorrows.</span>
        </h1>
        <p className="mt-8 max-w-md text-lg leading-8 text-[#587066] sm:text-xl">
          Save consistently, stay accountable, and build toward something that
          matters to you.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/register"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#b96549] px-6 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(185,101,73,0.22)] transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            Start saving
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#cdbda9] px-6 text-sm font-semibold text-[#173b32] transition hover:bg-[#fffaf2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            I already have an account
          </Link>
        </div>
        <p className="mt-6 max-w-sm text-xs leading-5 text-[#7b8179]">
          NIA helps you track a savings commitment and, if you choose, involve
          someone you trust. We never hold or move your money.
        </p>
      </div>

      <div
        className="hidden sm:block relative mx-auto w-full max-w-[34rem]"
        aria-label="A calm space for your savings intentions"
        role="img"
      >
        <div className="relative aspect-[0.92] overflow-hidden rounded-[2.5rem] bg-[#f3cdbb] shadow-[0_24px_60px_rgba(132,83,63,0.14)] sm:aspect-square">
          <div
            className="absolute -right-16 -top-16 size-56 rounded-full border-[18px] border-[#eab49e]"
            aria-hidden="true"
          />
          <div
            className="absolute -bottom-20 -left-16 size-64 rounded-full border-[22px] border-[#f8dfd2]"
            aria-hidden="true"
          />
          <div
            className="absolute left-[14%] top-[12%] size-4 rounded-full bg-[#b96549]"
            aria-hidden="true"
          />
          <div
            className="absolute bottom-[17%] right-[15%] size-3 rounded-full bg-[#173b32]"
            aria-hidden="true"
          />

          <div className="absolute inset-x-[11%] bottom-[10%] rounded-[2rem] border border-white/70 bg-[#fffaf2]/90 p-6 shadow-[0_14px_30px_rgba(132,83,63,0.12)] backdrop-blur-sm sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a95f45]">
              A little space for
            </p>
            <p className="mt-4 font-serif text-3xl italic leading-tight text-[#173b32] sm:text-4xl">
              My dreams
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-sm text-[#587066]">
              <span className="rounded-full bg-[#f7eee4] px-3 py-1.5">
                My savings
              </span>
              <span className="rounded-full bg-[#e5efe5] px-3 py-1.5">
                My future
              </span>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center font-serif text-sm italic text-[#7b8179]">
          Your promise, one gentle step at a time.
        </p>
      </div>
    </section>
  );
}
