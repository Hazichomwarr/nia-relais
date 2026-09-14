"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { logoutAction } from "@/src/actions/auth.actions";

type AppNavigationProps = {
  userName: string;
};

export function AppNavigation({ userName }: AppNavigationProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
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
    <header className="border-b border-[var(--nia-border)] bg-[var(--nia-surface)] px-4 py-3 sm:px-8">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
        <Link
          href="/dashboard"
          aria-label="NIA dashboard, powered by RELAIS"
          className="group flex shrink-0 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]"
        >
          <Image src="/images/nia-logo.png" alt="NIA logo" width={40} height={40} priority className="size-10" />
          <span className="flex flex-col leading-none">
            <span className="font-serif text-lg font-semibold tracking-[0.12em] text-[var(--nia-text)] transition-colors group-hover:text-[var(--nia-primary)]">
              NIA
            </span>
            <span className="mt-1 text-[0.5rem] font-semibold uppercase tracking-[0.16em] text-[var(--nia-text-muted)]">
              powered by RELAIS
            </span>
          </span>
        </Link>

        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls="mobile-primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex size-11 items-center justify-center rounded-full border border-[var(--nia-border)] text-[var(--nia-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)] sm:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">☰</span>
        </button>

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-x-5 sm:flex">
          <nav aria-label="Primary navigation" className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.isActive ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)] ${
                  item.isActive
                    ? "bg-[var(--nia-active-soft)] text-[var(--nia-text)] shadow-sm"
                    : "text-[var(--nia-text-muted)] hover:bg-[var(--nia-surface-soft)] hover:text-[var(--nia-text)]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="max-w-[9rem] truncate text-sm text-[var(--nia-text-muted)]" title={`Hello, ${userName}`}>
            Hello, {userName}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-[var(--nia-border)] px-4 py-2 text-sm font-semibold text-[var(--nia-text)] transition-colors hover:border-[var(--nia-primary)] hover:bg-[var(--nia-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {menuOpen ? (
        <div id="mobile-primary-navigation" className="mx-auto mt-3 max-w-7xl border-t border-[var(--nia-border)] pt-3 sm:hidden">
          <nav aria-label="Primary navigation" className="grid gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.isActive ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
                className={`flex min-h-11 items-center rounded-xl px-4 text-sm font-medium ${item.isActive ? "bg-[var(--nia-active-soft)] text-[var(--nia-text)]" : "text-[var(--nia-text-muted)] hover:bg-[var(--nia-surface-soft)]"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--nia-border)] pt-3">
            <span className="max-w-[12rem] truncate text-sm text-[var(--nia-text-muted)]">Hello, {userName}</span>
            <form action={logoutAction}>
              <button type="submit" className="min-h-11 rounded-full border border-[var(--nia-border)] px-4 text-sm font-semibold text-[var(--nia-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)]">Sign out</button>
            </form>
          </div>
        </div>
      ) : null}
    </header>
  );
}
