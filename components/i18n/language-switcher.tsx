"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocaleAction } from "@/src/actions/locale.actions";
import type { Locale } from "@/src/i18n/config";

export function LanguageSwitcher({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function selectLocale(nextLocale: Locale) {
    if (nextLocale === locale) return;
    startTransition(async () => {
      await setLocaleAction(nextLocale);
      router.refresh();
    });
  }

  return (
    <div className={`inline-flex items-center rounded-full border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-1 text-xs font-bold tracking-[0.1em] text-[var(--nia-text-muted)] ${compact ? "" : ""}`} aria-label="Language">
      {(["en", "fr"] as const).map((option) => (
        <button key={option} type="button" onClick={() => selectLocale(option)} disabled={pending} aria-pressed={locale === option} className={`min-h-8 rounded-full px-2.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)] disabled:opacity-60 ${locale === option ? "bg-[var(--nia-primary)] text-white" : "hover:text-[var(--nia-primary)]"}`}>
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
