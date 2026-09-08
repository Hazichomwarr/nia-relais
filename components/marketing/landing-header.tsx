import Image from "next/image";
import Link from "next/link";

export function LandingHeader() {
  return (
    <header className="flex items-center justify-between gap-6">
      <Link href="/" aria-label="NIA, powered by RELAIS" className="group flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]">
        <Image src="/images/nia-logo.png" alt="NIA logo" width={44} height={44} priority className="size-11 shrink-0" />
        <span className="flex flex-col leading-none">
          <span className="font-serif text-xl font-semibold tracking-[0.12em] text-[#173b32] transition-colors group-hover:text-[#a95f45]">
            NIA
          </span>
          <span className="mt-1 text-[0.55rem] font-semibold uppercase tracking-[0.18em] text-[#7b8179]">
            powered by RELAIS
          </span>
        </span>
      </Link>

      <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-5">
        <span className="hidden rounded-full border border-[#d8cbb9] bg-[#fffaf2] px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-[#173b32] sm:inline-flex">
          EN <span className="mx-1 text-[#c98268]">/</span> FR
        </span>
        <Link href="/login" className="rounded-full px-3 py-2 text-sm font-semibold text-[#587066] transition-colors hover:text-[#173b32] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] sm:px-4">
          Log in
        </Link>
        <Link href="/register" className="hidden rounded-full bg-[#b96549] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(185,101,73,0.2)] transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] sm:inline-flex">
          Start saving
        </Link>
      </nav>
    </header>
  );
}
