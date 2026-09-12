"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "@/src/actions/auth.actions";

type AppNavigationProps = {
  userName: string;
};

export function AppNavigation({ userName }: AppNavigationProps) {
  const pathname = usePathname();
  const isSavingsRoute =
    pathname === "/deposits" ||
    /^\/goals\/[^/]+\/deposits(?:\/|$)/.test(pathname);
  const isCirclesRoute = pathname === "/circles" || pathname.startsWith("/circles/");
  const navItems = [
    { href: "/dashboard", label: "Dashboard", isActive: pathname === "/dashboard" },
    { href: "/deposits", label: "My savings", isActive: isSavingsRoute },
    {
      href: "/custodian",
      label: "Trusted person",
      isActive: pathname === "/custodian" || pathname.startsWith("/custodian/"),
    },
    { href: "/circles", label: "SUSU circles", isActive: isCirclesRoute },
  ];

  return (
    <header className="border-b border-[#e2d7c9] bg-[#fffaf2] px-4 py-3 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Link
          href="/dashboard"
          aria-label="NIA dashboard, powered by RELAIS"
          className="group flex shrink-0 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
        >
          <Image src="/images/nia-logo.png" alt="NIA logo" width={40} height={40} priority className="size-10" />
          <span className="flex flex-col leading-none">
            <span className="font-serif text-lg font-semibold tracking-[0.12em] text-[#173b32] transition-colors group-hover:text-[#a95f45]">
              NIA
            </span>
            <span className="mt-1 text-[0.5rem] font-semibold uppercase tracking-[0.16em] text-[#7b8179]">
              powered by RELAIS
            </span>
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-5">
          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.isActive ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] ${
                  item.isActive
                    ? "bg-[#dce9dc] text-[#173b32] shadow-sm"
                    : "text-[#587066] hover:bg-[#f7eee4] hover:text-[#173b32]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="max-w-[9rem] truncate text-sm text-[#7b8179]" title={`Hello, ${userName}`}>
            Hello, {userName}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-[#cdbda9] px-4 py-2 text-sm font-semibold text-[#173b32] transition-colors hover:border-[#b96549] hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
