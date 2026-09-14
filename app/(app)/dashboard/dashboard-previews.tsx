import Link from "next/link";

import type { OwnerCircleIndexItem } from "@/src/services/circle-owner-index.service";
import type { PersonalGoalDashboardSummary } from "@/src/services/goal.service";

import { formatContributionMoney } from "../circles/[circleId]/contribution-desk-display";
import { formatOwnerDate } from "../circles/[circleId]/circle-workspace-display";
import { getFrequencyLabel } from "../circles/new/new-circle-form-display";

function TargetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="m16.5 7.5 3.5-3.5M17.5 4H20v2.5" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.8 19c.7-3 2.4-4.6 5.2-4.6s4.5 1.6 5.2 4.6" />
      <path d="M15.5 5.8a2.7 2.7 0 0 1 0 5.1M16.2 14.7c2.1.3 3.4 1.7 4 4.3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <path d="m7.5 4 5.5 6-5.5 6" />
    </svg>
  );
}

export function DashboardGoalPreview({ goal, secondary = false }: { goal: PersonalGoalDashboardSummary; secondary?: boolean }) {
  const progress = Math.min(goal.progressPercent, 100);

  return (
    <article className={`rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-5 ${secondary ? "hidden sm:block" : ""}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--nia-active-soft)] text-[var(--nia-primary)]"><TargetIcon /></span>
        <h3 className="min-w-0 truncate font-serif text-xl text-[var(--nia-text)]">{goal.name}</h3>
      </div>
      <p className="mt-5 text-sm font-semibold text-[var(--nia-text)]">
        {formatContributionMoney(goal.savedAmount, goal.currency)} <span className="font-normal text-[var(--nia-text-muted)]">of {formatContributionMoney(goal.targetAmount, goal.currency)}</span>
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div aria-label={`${formatProgress(goal.progressPercent)}% of target recorded`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--nia-border)]" role="progressbar">
          <div className="h-full rounded-full bg-[var(--nia-secondary)]" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs font-bold text-[var(--nia-text-muted)]">{formatProgress(goal.progressPercent)}%</span>
      </div>
      <div className="mt-5 flex items-start gap-3 border-t border-[var(--nia-border)] pt-4 text-sm">
        <span aria-hidden="true" className="mt-0.5 text-[var(--nia-primary)]"><CalendarIcon /></span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--nia-text-muted)]">Unlocks</p>
          <time className="mt-1 block font-medium text-[var(--nia-text)]" dateTime={goal.unlockDate}>{formatGoalDate(goal.unlockDate)}</time>
        </div>
      </div>
      <Link href={`/goals/${encodeURIComponent(goal.id)}/deposits`} className="mt-5 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--nia-primary)] transition hover:text-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
        Continue saving <ChevronIcon />
      </Link>
    </article>
  );
}

export function DashboardCirclePreview({ circle }: { circle: OwnerCircleIndexItem | null }) {
  if (!circle) {
    return (
      <div className="rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-5">
        <span aria-hidden="true" className="inline-flex size-11 items-center justify-center rounded-full bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]"><GroupIcon /></span>
        <h3 className="mt-4 font-serif text-xl text-[var(--nia-text)]">Start saving together</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">Create a SUSU circle when you are ready to plan a shared savings rotation.</p>
        <Link href="/circles/new" className="mt-5 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--nia-primary)] transition hover:text-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
          Create circle <ChevronIcon />
        </Link>
      </div>
    );
  }

  const round = circle.currentOrNextRound;
  const isDraft = circle.status === "DRAFT";

  return (
    <article className="rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full ${isDraft ? "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]" : "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]"}`}><GroupIcon /></span>
          <div className="min-w-0">
            <h3 className="truncate font-serif text-xl text-[var(--nia-text)]">{circle.name}</h3>
            <p className="mt-1 text-sm text-[var(--nia-text-muted)]">{formatContributionMoney(circle.contributionAmount, circle.currency)} · {getFrequencyLabel(circle.frequency)}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-bold tracking-[0.12em] ${isDraft ? "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]" : circle.status === "ACTIVE" ? "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]" : "bg-[var(--nia-border)] text-[var(--nia-text-muted)]"}`}>{circle.status}</span>
      </div>

      <div className="my-5 border-t border-[var(--nia-border)]" />

      {round ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 text-[var(--nia-primary)]"><CalendarIcon /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--nia-text-muted)]">{round.status === "ACTIVE" ? "Current round" : "Next round"}</p>
              <p className="mt-1 font-semibold text-[var(--nia-text)]">Round {round.roundNumber} · {round.recipientDisplayName}</p>
              <p className="mt-1 text-sm text-[var(--nia-text-muted)]">Scheduled for {formatOwnerDate(round.dueDate)}</p>
            </div>
          </div>
          <p className="text-sm sm:text-right"><span className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--nia-text-muted)]">Members</span><span className="mt-1 block font-semibold text-[var(--nia-text)]">{circle.memberCount}</span></p>
        </div>
      ) : (
        <p className="text-sm leading-6 text-[var(--nia-text-muted)]">{isDraft ? `${circle.memberCount} member${circle.memberCount === 1 ? "" : "s"} added. Finish setup to get started.` : `This circle is complete with ${circle.memberCount} member${circle.memberCount === 1 ? "" : "s"}.`}</p>
      )}

      <Link href={`/circles/${encodeURIComponent(circle.id)}`} className="mt-5 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--nia-primary)] transition hover:text-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
        {isDraft ? "Finish setup" : "Continue circle"} <ChevronIcon />
      </Link>
    </article>
  );
}

function formatGoalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatProgress(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
