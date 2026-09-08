import Image from "next/image";

import { logoutAction } from "@/src/actions/auth.actions";
import { requireUser } from "@/src/auth/require-user";
import Link from "next/link";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-[#fbf7ef] text-[#173b32]">
      <header className="border-b border-[#e2d7c9] bg-[#fffaf2] px-4 py-3 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Link href="/dashboard" aria-label="NIA dashboard, powered by RELAIS" className="group flex shrink-0 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]">
            <Image src="/images/nia-logo.png" alt="NIA logo" width={40} height={40} priority className="size-10" />
            <span className="flex flex-col leading-none">
              <span className="font-serif text-lg font-semibold tracking-[0.12em] text-[#173b32] transition-colors group-hover:text-[#a95f45]">NIA</span>
              <span className="mt-1 text-[0.5rem] font-semibold uppercase tracking-[0.16em] text-[#7b8179]">powered by RELAIS</span>
            </span>
          </Link>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-5">
            <Link href="/custodian" className="rounded-full px-3 py-2 text-sm font-medium text-[#587066] transition-colors hover:bg-[#f7eee4] hover:text-[#173b32] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">
            Custodian requests
            </Link>
            <span className="max-w-[9rem] truncate text-sm text-[#7b8179]" title={`Hello, ${user.name}`}>Hello, {user.name}</span>
            <form action={logoutAction}>
              <button type="submit" className="rounded-full border border-[#cdbda9] px-4 py-2 text-sm font-semibold text-[#173b32] transition-colors hover:border-[#b96549] hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
