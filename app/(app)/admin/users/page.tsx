import type { Metadata } from "next";
import Link from "next/link";

import { PageBackLink } from "@/components/navigation/page-back-link";
import { requireSuperAdmin } from "@/src/auth/require-super-admin";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";
import { getFounderUserDirectory, type FounderDirectoryEntry } from "@/src/services/founder-user-directory.service";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function hrefFor(query: { search: string; category: string; page?: number }) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.category !== "ALL") params.set("category", query.category);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const serialized = params.toString();
  return serialized ? `/admin/users?${serialized}` : "/admin/users";
}

function productClassification(
  entry: FounderDirectoryEntry,
  selectedCategory: string,
  dictionary: Awaited<ReturnType<typeof getDictionary>>,
) {
  const copy = dictionary.adminDirectory;
  if (entry.category === "BOTH" && selectedCategory === "PERSONAL_SAVINGS") {
    return { label: copy.personalSavings, secondaryLabel: copy.alsoOwnsSusuCircles };
  }
  if (entry.category === "BOTH" && selectedCategory === "SUSU") {
    return { label: copy.susu, secondaryLabel: copy.alsoOwnsPersonalSavings };
  }
  return {
    label: {
      PERSONAL_SAVINGS: copy.personalSavings,
      SUSU: copy.susu,
      BOTH: copy.both,
      NEITHER: copy.neither,
    }[entry.category],
  };
}

export default async function FounderUserDirectoryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSuperAdmin();
  const [locale, rawQuery] = await Promise.all([getLocale(), searchParams]);
  const [directory, dictionary] = await Promise.all([getFounderUserDirectory(rawQuery), Promise.resolve(getDictionary(locale))]);
  const copy = dictionary.adminDirectory;
  const dateFormatter = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "medium", timeZone: "UTC" });
  const categoryOptions = ["ALL", "PERSONAL_SAVINGS", "SUSU", "BOTH", "NEITHER"] as const;
  const categoryLabels = {
    ALL: copy.all,
    PERSONAL_SAVINGS: copy.personalSavings,
    SUSU: copy.susu,
    BOTH: copy.both,
    NEITHER: copy.neither,
  };

  return (
    <main className="min-h-[calc(100dvh-73px)] bg-[var(--nia-app-background)] px-4 py-8 text-[var(--nia-text)] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <PageBackLink href="/admin" label={copy.backToOverview} />
        <header className="mt-4 max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">{copy.eyebrow}</p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">{copy.title}</h1>
          <p className="mt-4 text-base leading-7 text-[var(--nia-text-muted)]">{copy.description}</p>
        </header>

        <form action="/admin/users" className="mt-8 grid gap-3 rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-surface)] p-4 shadow-sm sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="grid gap-2 text-sm font-semibold">
            {copy.searchUsers}
            <input name="search" defaultValue={directory.search} maxLength={100} className="min-h-11 rounded-xl border border-[var(--nia-border)] bg-white px-3 text-base font-normal outline-none focus:border-[var(--nia-primary)]" />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            {copy.all}
            <select name="category" defaultValue={directory.category} className="min-h-11 rounded-xl border border-[var(--nia-border)] bg-white px-3 text-base font-normal outline-none focus:border-[var(--nia-primary)]">
              {categoryOptions.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-xl bg-[var(--nia-primary)] px-5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">{copy.search}</button>
        </form>

        <p className="mt-5 text-sm text-[var(--nia-text-muted)]">{`${directory.totalMatchingUsers} ${copy.results}`}</p>

        {directory.entries.length === 0 ? (
          <p className="mt-4 rounded-3xl border border-dashed border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-6 text-sm text-[var(--nia-text-muted)]">{copy.noUsersFound}</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-surface)] shadow-sm">
            <div className="hidden grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_auto_auto_auto] gap-4 border-b border-[var(--nia-border)] px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--nia-text-muted)] md:grid">
              <span>{copy.users}</span><span>{copy.registered}</span><span>{copy.personalSavings}</span><span>{copy.susu}</span><span>{copy.all}</span>
            </div>
            <ul>
              {directory.entries.map((entry) => (
                <li key={entry.id} className="grid gap-3 border-b border-[var(--nia-border)] px-5 py-5 last:border-0 md:grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_auto_auto_auto] md:items-center md:gap-4">
                  <div className="min-w-0"><p className="truncate font-semibold">{entry.name ?? "—"}</p><p className="mt-1 truncate text-sm text-[var(--nia-text-muted)]">{entry.email ?? "—"}</p></div>
                  <p className="text-sm text-[var(--nia-text-muted)]"><span className="mr-2 font-semibold md:hidden">{copy.registered}:</span>{dateFormatter.format(new Date(entry.registeredAt))}</p>
                  <p className="text-sm"><span className="mr-2 font-semibold md:hidden">{copy.goals}:</span>{entry.goalCount}</p>
                  <p className="text-sm"><span className="mr-2 font-semibold md:hidden">{copy.circles}:</span>{entry.circleCount}</p>
                  {(() => {
                    const classification = productClassification(entry, directory.category, dictionary);
                    return (
                      <div className="w-fit">
                        <span className="rounded-full bg-[var(--nia-active-soft)] px-3 py-1 text-xs font-bold text-[var(--nia-primary)]">{classification.label}</span>
                        {"secondaryLabel" in classification ? <p className="mt-2 text-xs text-[var(--nia-text-muted)]">{classification.secondaryLabel}</p> : null}
                      </div>
                    );
                  })()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {directory.pageCount > 1 ? (
          <nav aria-label={copy.users} className="mt-6 flex items-center justify-between gap-4">
            {directory.page > 1 ? <Link href={hrefFor({ search: directory.search, category: directory.category, page: directory.page - 1 })} className="inline-flex min-h-11 items-center rounded-full border border-[var(--nia-border)] px-4 text-sm font-semibold">{copy.previous}</Link> : <span />}
            {directory.page < directory.pageCount ? <Link href={hrefFor({ search: directory.search, category: directory.category, page: directory.page + 1 })} className="inline-flex min-h-11 items-center rounded-full border border-[var(--nia-border)] px-4 text-sm font-semibold">{copy.next}</Link> : <span />}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
