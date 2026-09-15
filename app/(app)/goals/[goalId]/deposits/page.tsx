import { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GoalNotFoundOrUnauthorizedError, requireGoalOwner } from "@/src/auth/require-goal-owner";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";
import { getDepositHistoryForGoal, type DepositHistoryItem } from "@/src/services/deposit.service";

import { formatDepositAmount, formatDepositDate } from "./deposit-display";
import { DepositHistoryFilters, type DepositRangeFilter, type DepositStatusFilter } from "./deposit-history-filters";
import DepositHistoryItemCard from "./deposit-history-item";

type DepositSearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusFilters = new Set<DepositStatusFilter>(["all", "APPROVED", "PENDING", "REJECTED"]);
const rangeFilters = new Set<DepositRangeFilter>(["all", "30d", "90d", "year"]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatusFilter(value: string | string[] | undefined): DepositStatusFilter {
  const candidate = firstValue(value);
  return candidate && statusFilters.has(candidate as DepositStatusFilter) ? candidate as DepositStatusFilter : "all";
}

function parseRangeFilter(value: string | string[] | undefined): DepositRangeFilter {
  const candidate = firstValue(value);
  return candidate && rangeFilters.has(candidate as DepositRangeFilter) ? candidate as DepositRangeFilter : "all";
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateIsInRange(value: string, range: DepositRangeFilter) {
  if (range === "all") return true;
  const now = new Date();
  const depositDate = toUtcDate(value);
  if (range === "year") return depositDate >= new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const days = range === "30d" ? 30 : 90;
  return depositDate >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

function filterDeposits(deposits: DepositHistoryItem[], status: DepositStatusFilter, range: DepositRangeFilter) {
  return deposits.filter((deposit) => (status === "all" || deposit.status === status) && dateIsInRange(deposit.depositDate, range));
}

export default async function DepositHistoryPage({ params, searchParams }: { params: Promise<{ goalId: string }>; searchParams: DepositSearchParams }) {
  const [{ goalId }, rawSearchParams, locale] = await Promise.all([params, searchParams, getLocale()]);
  const dictionary = getDictionary(locale);
  const copy = dictionary.personalSavings;
  const status = parseStatusFilter(rawSearchParams.status);
  const range = parseRangeFilter(rawSearchParams.range);
  let authority;

  try {
    authority = await requireGoalOwner(goalId);
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) notFound();
    throw error;
  }

  const { goal } = authority;
  const deposits = await getDepositHistoryForGoal(goal.id);
  const filteredDeposits = filterDeposits(deposits, status, range);
  const confirmedDeposits = deposits.filter((deposit) => deposit.status === "APPROVED");
  const pendingDeposits = deposits.filter((deposit) => deposit.status === "PENDING");
  const rejectedDeposits = deposits.filter((deposit) => deposit.status === "REJECTED");
  const confirmedTotal = confirmedDeposits.reduce((total, deposit) => total.plus(deposit.amount), new Prisma.Decimal(0));
  const rawProgress = goal.targetAmount.gt(0) ? confirmedTotal.div(goal.targetAmount).mul(100) : new Prisma.Decimal(0);
  const progressPercent = Prisma.Decimal.min(rawProgress, new Prisma.Decimal(100)).toDecimalPlaces(0).toString();
  const recordSavingsHref = `/goals/${encodeURIComponent(goal.id)}/deposits/new`;

  return (
    <main className="min-h-[calc(100vh-73px)] overflow-hidden bg-[var(--nia-app-background)] px-5 py-8 text-[var(--nia-text)] sm:px-8 sm:py-12">
      <div className="relative mx-auto w-full max-w-6xl">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-8 hidden size-72 rounded-full border border-[var(--nia-border)] opacity-45 lg:block" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-[31rem] hidden size-56 rounded-full border border-[var(--nia-border)] opacity-30 lg:block" />

        <nav aria-label={dictionary.common.breadcrumb} className="relative flex min-w-0 items-center gap-2 text-sm text-[var(--nia-text-muted)]">
          <Link href="/deposits" className="truncate transition hover:text-[var(--nia-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">{dictionary.common.mySavings}</Link>
          <span aria-hidden="true">›</span>
          <span className="truncate font-medium text-[var(--nia-text)]">{goal.name}</span>
        </nav>

        <header className="relative mt-7 grid gap-6 rounded-[1.75rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-6 shadow-sm sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">{copy.savingsRecord}</p>
            <h1 className="mt-3 break-words font-serif text-4xl tracking-tight sm:text-5xl">{goal.name}</h1>
            <p className="mt-3 text-base font-medium text-[var(--nia-text-muted)]">{formatDepositAmount(goal.weeklyAmount.toFixed(2), goal.currency)} {copy.committedEachWeek}</p>
            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--nia-text-muted)]">{copy.motivationalCopy}</p>
          </div>
          {goal.status === "ACTIVE" ? <RecordSavingsLink href={recordSavingsHref} label={copy.recordSavings} /> : null}
        </header>

        <section className="relative mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.savingsSummary}>
          <SummaryCard kind="confirmed" label={copy.confirmed} value={confirmedDeposits.length} detail={copy.totalDeposits} />
          <SummaryCard kind="pending" label={copy.awaitingConfirmation} value={pendingDeposits.length} detail={copy.pendingReview} />
          <SummaryCard kind="rejected" label={copy.notConfirmed} value={rejectedDeposits.length} detail={copy.notAccepted} />
          <SummaryCard kind="total" label={copy.totalSaved} value={formatDepositAmount(confirmedTotal.toFixed(2), goal.currency)} detail={copy.ofTarget.replace("{amount}", formatDepositAmount(goal.targetAmount.toFixed(2), goal.currency))} progressPercent={progressPercent} progressLabel={copy.progress} />
        </section>

        <div className="relative mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] lg:items-start">
          <section className="rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm sm:p-7" aria-labelledby="savings-history-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">{copy.yourSavings}</p>
                <h2 id="savings-history-heading" className="mt-2 font-serif text-3xl tracking-tight">{copy.historyTitle}</h2>
              </div>
              {goal.status === "ACTIVE" ? <RecordSavingsLink href={recordSavingsHref} compact label={copy.recordSavings} /> : null}
            </div>

            {deposits.length === 0 ? <EmptySavingsState canRecord={goal.status === "ACTIVE"} recordSavingsHref={recordSavingsHref} dictionary={dictionary} /> : <>
              <DepositHistoryFilters goalId={goal.id} status={status} range={range} dictionary={dictionary} />
              {filteredDeposits.length === 0 ? (
                <section className="mt-5 rounded-2xl border border-dashed border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-6" aria-label={copy.filteredEmptyLabel}>
                  <p className="font-serif text-xl">{copy.filteredEmpty}</p>
                  <Link href={`/goals/${encodeURIComponent(goal.id)}/deposits`} className="mt-3 inline-flex text-sm font-semibold text-[var(--nia-primary)] transition hover:text-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">{copy.resetFilters} <span aria-hidden="true">→</span></Link>
                </section>
              ) : <>
                <div className="mt-6 flex items-center justify-between gap-4 text-sm text-[var(--nia-text-muted)]"><p>{filteredDeposits.length} {filteredDeposits.length === 1 ? copy.savingFound : copy.savingsFound}</p><p>{copy.newestFirst}</p></div>
                <ul className="mt-3 space-y-2" aria-label={copy.savingsHistory}>{filteredDeposits.map((deposit) => <DepositHistoryItemCard key={deposit.id} deposit={deposit} currency={goal.currency} dictionary={dictionary} locale={locale} />)}</ul>
              </>}
            </>}
          </section>

          <aside className="space-y-5 lg:sticky lg:top-24" aria-label={copy.goalContext}>
            <section className="rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm sm:p-6" aria-labelledby="about-goal-heading">
              <h2 id="about-goal-heading" className="font-serif text-2xl tracking-tight">{copy.aboutGoal}</h2>
              <div className="mt-5 flex items-start gap-3"><span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--nia-active-soft)] text-[var(--nia-primary)]"><GoalIcon /></span><div className="min-w-0"><p className="break-words font-semibold text-[var(--nia-text)]">{goal.name}</p><p className="mt-1 text-sm text-[var(--nia-text-muted)]">{formatDepositAmount(goal.weeklyAmount.toFixed(2), goal.currency)} · {copy.committedEachWeek}</p></div></div>
              <dl className="mt-6 space-y-4 border-y border-[var(--nia-border)] py-5 text-sm"><GoalDetail label={copy.targetAmountLabel} value={formatDepositAmount(goal.targetAmount.toFixed(2), goal.currency)} /><GoalDetail label={copy.unlocksOn} value={formatDepositDate(goal.unlockDate.toISOString().slice(0, 10), locale)} /></dl>
              <div className="mt-5"><div className="flex items-baseline justify-between gap-4"><p className="text-sm font-semibold text-[var(--nia-text)]">{formatDepositAmount(confirmedTotal.toFixed(2), goal.currency)} {copy.saved}</p><p className="text-sm font-bold text-[var(--nia-primary)]">{progressPercent}%</p></div><ProgressBar progressPercent={progressPercent} label={copy.progress} /></div>
              <p className="mt-6 rounded-2xl bg-[var(--nia-active-soft)] px-4 py-3 text-sm leading-6 text-[var(--nia-primary)]">{copy.progressMicrocopy}</p>
            </section>
            <section className="hidden rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-5 text-[var(--nia-text-muted)] lg:block"><p className="font-serif text-xl leading-7 text-[var(--nia-text)]">{copy.disciplineQuote}</p><p className="mt-3 text-xs font-bold uppercase tracking-[0.15em] text-[var(--nia-primary)]">— NIA</p></section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function RecordSavingsLink({ href, compact = false, label }: { href: string; compact?: boolean; label: string }) {
  return <Link href={href} className={`inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--nia-secondary)] font-semibold text-white shadow-sm transition hover:bg-[var(--nia-secondary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-secondary)] ${compact ? "px-4 text-sm" : "w-full px-5 sm:w-fit"}`}>+ {label}</Link>;
}

function SummaryCard({ kind, label, value, detail, progressPercent, progressLabel }: { kind: "confirmed" | "pending" | "rejected" | "total"; label: string; value: number | string; detail: string; progressPercent?: string; progressLabel?: string }) {
  const iconClassName = kind === "confirmed" || kind === "total" ? "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]" : kind === "pending" ? "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]" : "bg-[var(--nia-draft-soft)] text-[var(--nia-secondary)]";
  return <section className="rounded-[1.35rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-4 shadow-sm"><div className="flex items-start gap-3"><span aria-hidden="true" className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${iconClassName}`}><SummaryIcon kind={kind} /></span><div className="min-w-0"><p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[var(--nia-text-muted)]">{label}</p><p className="mt-1 truncate text-xl font-semibold text-[var(--nia-text)]">{value}</p><p className="mt-1 text-xs text-[var(--nia-text-muted)]">{detail}</p></div></div>{progressPercent && progressLabel ? <ProgressBar progressPercent={progressPercent} compact label={progressLabel} /> : null}</section>;
}

function ProgressBar({ progressPercent, compact = false, label }: { progressPercent: string; compact?: boolean; label: string }) {
  return <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-[var(--nia-border)]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(progressPercent)} aria-valuetext={`${progressPercent}%`}><span className="block h-full rounded-full bg-[var(--nia-primary)]" style={{ width: `${progressPercent}%` }} /></div>{compact ? <p className="mt-1.5 text-right text-xs font-bold text-[var(--nia-primary)]">{progressPercent}%</p> : null}</div>;
}

function GoalDetail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="text-[var(--nia-text-muted)]">{label}</dt><dd className="text-right font-semibold text-[var(--nia-text)]">{value}</dd></div>;
}

function EmptySavingsState({ canRecord, recordSavingsHref, dictionary }: { canRecord: boolean; recordSavingsHref: string; dictionary: ReturnType<typeof getDictionary> }) {
  const copy = dictionary.personalSavings;
  return <section className="mt-6 rounded-2xl border border-dashed border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-6 sm:p-8"><p className="font-serif text-2xl tracking-tight">{copy.firstSavingTitle}</p><p className="mt-2 max-w-md text-sm leading-6 text-[var(--nia-text-muted)]">{copy.firstSavingDescription}</p>{canRecord ? <Link href={recordSavingsHref} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--nia-secondary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--nia-secondary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-secondary)]">{copy.recordFirstSaving}</Link> : null}</section>;
}

function GoalIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5"><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3" /><path d="m16.5 7.5 3.5-3.5M17.5 4H20v2.5" /></svg>; }

function SummaryIcon({ kind }: { kind: "confirmed" | "pending" | "rejected" | "total" }) {
  if (kind === "confirmed") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5"><circle cx="12" cy="12" r="7.5" /><path d="m8.5 12.2 2.3 2.3 4.8-4.8" /></svg>;
  if (kind === "pending") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-5"><circle cx="12" cy="12" r="7.5" /><path d="M12 7.8v4.5l3 1.8" /></svg>;
  if (kind === "rejected") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5"><circle cx="12" cy="12" r="7.5" /><path d="m9.3 9.3 5.4 5.4m0-5.4-5.4 5.4" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5"><path d="M4.5 12h15M12 4.5v15" /><circle cx="12" cy="12" r="7.5" /></svg>;
}
