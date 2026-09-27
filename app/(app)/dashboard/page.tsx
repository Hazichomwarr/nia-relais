import Link from "next/link";
import { requireUser } from "@/src/auth/require-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";
import { getCirclesForOwnerIndex } from "@/src/services/circle-owner-index.service";
import { getCustodianInboxForUser } from "@/src/services/custodian.service";
import { getPendingDepositsForCustodian } from "@/src/services/custodian-deposit.service";
import { getPersonalGoalsForDashboard } from "@/src/services/goal.service";
import { getFirstName } from "@/src/presentation/first-name";

function HomeIcon({ kind }: { kind: "savings" | "circles" | "trusted" }) {
  const paths = kind === "savings"
    ? <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3" /><path d="m16.5 7.5 3.5-3.5M17.5 4H20v2.5" /></>
    : kind === "circles"
      ? <><circle cx="9" cy="8" r="3" /><path d="M3.8 19c.7-3 2.4-4.6 5.2-4.6s4.5 1.6 5.2 4.6" /><path d="M15.5 5.8a2.7 2.7 0 0 1 0 5.1M16.2 14.7c2.1.3 3.4 1.7 4 4.3" /></>
      : <><path d="M12 3.5 19 6v5.3c0 4.3-2.9 7.4-7 9.2-4.1-1.8-7-4.9-7-9.2V6l7-2.5Z" /><path d="m8.8 12 2.1 2.1 4.4-4.4" /></>;

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6">{paths}</svg>;
}

function HomeCard({ href, title, status, description, kind }: { href: string; title: string; status: string; description: string; kind: "savings" | "circles" | "trusted" }) {
  return (
    <Link href={href} className="group flex min-h-28 items-center gap-4 rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm transition hover:border-[var(--nia-primary)] hover:bg-[var(--nia-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
      <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--nia-active-soft)] text-[var(--nia-primary)]"><HomeIcon kind={kind} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-2xl tracking-tight">{title}</span>
        <span className="mt-1 block text-sm font-semibold">{status}</span>
        <span className="mt-1 block text-sm leading-5 text-[var(--nia-text-muted)]">{description}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-3xl text-[var(--nia-text-muted)] transition group-hover:translate-x-1">›</span>
    </Link>
  );
}

export default async function DashboardPage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const dictionary = getDictionary(locale);
  const copy = dictionary.dashboard;
  const [goals, circles, assignments, pendingDeposits] = await Promise.all([getPersonalGoalsForDashboard(user), getCirclesForOwnerIndex(user.id), getCustodianInboxForUser(user.id), getPendingDepositsForCustodian(user.id)]);
  const goalCount = goals.filter((goal) => goal.status === "ACTIVE").length;
  const circleCount = circles.filter((circle) => circle.status === "ACTIVE").length;
  const waitingCount = assignments.filter((assignment) => assignment.status === "PENDING").length + pendingDeposits.length;
  const withCount = (template: string, count: number) => template.replace("{count}", String(count));
  const firstName = getFirstName(user.name);

  return <main className="min-h-[calc(100dvh-73px)] bg-[var(--nia-app-background)] px-5 py-8 text-[var(--nia-text)] sm:px-8 sm:py-12"><div className="mx-auto w-full max-w-3xl"><header><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">NIA</p><h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">{firstName ? `${copy.homeGreeting}, ${firstName}.` : copy.homeGreeting}</h1><p className="mt-3 max-w-xl text-base leading-7 text-[var(--nia-text-muted)]">{copy.heroDescription}</p></header><nav aria-label={dictionary.common.primaryNavigation} className="mt-8 grid gap-4"><HomeCard href="/deposits" kind="savings" title={copy.personalSavings} status={withCount(goalCount === 1 ? copy.homeSavingsGoalOne : copy.homeSavingsGoalsMany, goalCount)} description={copy.homeSavingsDescription} /><HomeCard href="/circles" kind="circles" title={dictionary.common.susuCircles} status={withCount(circleCount === 1 ? copy.homeActiveCircleOne : copy.homeActiveCirclesMany, circleCount)} description={copy.homeCirclesDescription} /><HomeCard href="/custodian" kind="trusted" title={dictionary.common.trustedPerson} status={withCount(waitingCount === 1 ? copy.homeWaitingOne : copy.homeWaitingMany, waitingCount)} description={copy.homeTrustedDescription} /></nav><aside className="mt-8 rounded-3xl border border-[var(--nia-border)] bg-[var(--nia-active-soft)] p-6 text-[var(--nia-primary)]"><p className="font-serif text-xl leading-7">{copy.heroQuote}</p><p className="mt-3 text-xs font-bold uppercase tracking-[0.15em]">— NIA</p></aside></div></main>;
}
