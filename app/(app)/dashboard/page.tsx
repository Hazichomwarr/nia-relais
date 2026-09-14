import Link from "next/link";

import { requireUser } from "@/src/auth/require-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import { getCirclesForOwnerIndex } from "@/src/services/circle-owner-index.service";
import { getCustodianInboxForUser } from "@/src/services/custodian.service";
import { getPendingDepositsForCustodian } from "@/src/services/custodian-deposit.service";
import { getPersonalGoalsForDashboard } from "@/src/services/goal.service";

import { DashboardCirclePreview, DashboardGoalPreview } from "./dashboard-previews";
import { TrustedPersonDashboardCard } from "./trusted-person-dashboard-card";

function SummaryIcon({ kind }: { kind: "goal" | "circle" | "trusted" }) {
  const paths = kind === "goal"
    ? <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3" /><path d="m16.5 7.5 3.5-3.5M17.5 4H20v2.5" /></>
    : kind === "circle"
      ? <><circle cx="9" cy="8" r="3" /><path d="M3.8 19c.7-3 2.4-4.6 5.2-4.6s4.5 1.6 5.2 4.6" /><path d="M15.5 5.8a2.7 2.7 0 0 1 0 5.1M16.2 14.7c2.1.3 3.4 1.7 4 4.3" /></>
      : <><path d="M12 3.5 19 6v5.3c0 4.3-2.9 7.4-7 9.2-4.1-1.8-7-4.9-7-9.2V6l7-2.5Z" /><path d="m8.8 12 2.1 2.1 4.4-4.4" /></>;

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      {paths}
    </svg>
  );
}

function DashboardSummary({ activeGoalCount, activeCircleCount, waitingCount, dictionary }: { activeGoalCount: number; activeCircleCount: number; waitingCount: number; dictionary: Dictionary }) {
  const copy = dictionary.dashboard;
  const items = [
    { count: activeGoalCount, label: copy.activeGoals, detail: copy.keepGoing, kind: "goal" as const, iconClassName: "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]" },
    { count: activeCircleCount, label: copy.activeCircles, detail: copy.savingTogether, kind: "circle" as const, iconClassName: "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]" },
    { count: waitingCount, label: copy.itemsWaiting, detail: copy.asTrustedPerson, kind: "trusted" as const, iconClassName: "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]" },
  ];

  return (
    <section className="mt-8 rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-4 shadow-sm sm:p-5" aria-label={copy.summaryLabel}>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1.35fr] lg:items-center">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3 lg:border-r lg:border-[var(--nia-border)] lg:pr-4">
            <span aria-hidden="true" className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${item.iconClassName}`}><SummaryIcon kind={item.kind} /></span>
            <div>
              <p className="text-xl font-semibold text-[var(--nia-text)]">{item.count}</p>
              <p className="text-sm font-medium text-[var(--nia-text)]">{item.label}</p>
              <p className="text-xs text-[var(--nia-text-muted)]">{item.detail}</p>
            </div>
          </div>
        ))}
        <p className="border-t border-[var(--nia-border)] pt-4 text-sm leading-6 text-[var(--nia-text-muted)] lg:border-t-0 lg:pt-0">{copy.summaryQuote} <span aria-hidden="true">→</span></p>
      </div>
    </section>
  );
}

export default async function DashboardPage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const dictionary = getDictionary(locale);
  const copy = dictionary.dashboard;
  const [goals, circles, custodianAssignments, pendingDeposits] = await Promise.all([
    getPersonalGoalsForDashboard(user),
    getCirclesForOwnerIndex(user.id),
    getCustodianInboxForUser(user.id),
    getPendingDepositsForCustodian(user.id),
  ]);

  const activeGoals = goals.filter((goal) => goal.status === "ACTIVE");
  const activeCircleCount = circles.filter((circle) => circle.status === "ACTIVE").length;
  const featuredCircle = circles.find((circle) => circle.status === "ACTIVE") ?? circles.find((circle) => circle.status === "DRAFT") ?? circles[0] ?? null;
  const pendingInvitations = custodianAssignments.filter((assignment) => assignment.status === "PENDING");
  const activeAssignments = custodianAssignments.filter((assignment) => assignment.status === "ACTIVE");
  const hasHistoricalAssignments = custodianAssignments.some((assignment) => assignment.status === "DECLINED" || assignment.status === "CANCELLED" || assignment.status === "ENDED");
  const waitingCount = pendingInvitations.length + pendingDeposits.length;

  return (
    <main className="min-h-[calc(100vh-73px)] overflow-hidden bg-[var(--nia-app-background)] px-5 py-8 text-[var(--nia-text)] sm:px-8 sm:py-12">
      <div className="relative mx-auto w-full max-w-6xl">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-0 hidden size-64 rounded-full border border-[var(--nia-border)] opacity-45 lg:block" />
        <header className="relative grid gap-6 lg:grid-cols-[1fr_17rem] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">NIA</p>
            <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">{copy.heroWelcomeBack}, {user.name}</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-[var(--nia-text-muted)]">{copy.heroDescription}</p>
          </div>
          <aside className="rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-active-soft)] p-5 text-[var(--nia-primary)]">
            <p className="font-serif text-xl leading-7">{copy.heroQuote}</p>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.15em]">— NIA</p>
          </aside>
        </header>

        <DashboardSummary activeGoalCount={activeGoals.length} activeCircleCount={activeCircleCount} waitingCount={waitingCount} dictionary={dictionary} />

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="flex min-h-[31rem] flex-col rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm sm:p-7" aria-labelledby="personal-savings-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="personal-savings-heading" className="font-serif text-3xl tracking-tight">{copy.personalSavings}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">{copy.personalSavingsDescription}</p>
              </div>
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Link href="/deposits" className="text-[var(--nia-text-muted)] transition hover:text-[var(--nia-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">{copy.viewAll} <span aria-hidden="true">→</span></Link>
                <Link href="/goals/new" className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--nia-secondary)] px-4 text-white transition hover:bg-[var(--nia-secondary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-secondary)]">+ {copy.newGoal}</Link>
              </div>
            </div>
            {activeGoals.length > 0 ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {activeGoals.slice(0, 2).map((goal, index) => <DashboardGoalPreview key={goal.id} goal={goal} secondary={index === 1} dictionary={dictionary} locale={locale} />)}
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-5">
                <p className="font-serif text-xl">{copy.emptySavingsTitle}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">{copy.emptySavingsDescription}</p>
              </div>
            )}
          </section>

          <section className="flex min-h-[31rem] flex-col rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm sm:p-7" aria-labelledby="susu-circles-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="susu-circles-heading" className="font-serif text-3xl tracking-tight">{dictionary.common.susuCircles}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">{copy.susuDescription}</p>
              </div>
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Link href="/circles" className="text-[var(--nia-text-muted)] transition hover:text-[var(--nia-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">{copy.viewAll} <span aria-hidden="true">→</span></Link>
                <Link href="/circles/new" className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--nia-primary)] px-4 text-white transition hover:bg-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">+ {copy.createCircle}</Link>
              </div>
            </div>
            <div className="mt-6"><DashboardCirclePreview circle={featuredCircle} dictionary={dictionary} locale={locale} /></div>
          </section>
        </div>

        <TrustedPersonDashboardCard
          pendingInvitations={pendingInvitations}
          activeAssignments={activeAssignments}
          pendingDeposits={pendingDeposits}
          hasHistoricalAssignments={hasHistoricalAssignments}
          dictionary={dictionary}
        />
      </div>
    </main>
  );
}
