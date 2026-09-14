import Link from "next/link";
import type { ReactNode } from "react";

import type { OwnerCircleIndexItem } from "@/src/services/circle-owner-index.service";

import { formatContributionMoney } from "./[circleId]/contribution-desk-display";
import { formatOwnerDate } from "./[circleId]/circle-workspace-display";
import { getFrequencyLabel } from "./new/new-circle-form-display";

type CircleStatus = OwnerCircleIndexItem["status"];

const STATUS_PRESENTATION: Record<CircleStatus, { badgeClassName: string; iconClassName: string; stateSentence: string }> = {
  DRAFT: {
    badgeClassName: "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]",
    iconClassName: "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]",
    stateSentence: "Not active yet. Finish setup to get started.",
  },
  ACTIVE: {
    badgeClassName: "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]",
    iconClassName: "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]",
    stateSentence: "Circle is running. Keep track of contributions and upcoming payouts.",
  },
  COMPLETED: {
    badgeClassName: "bg-[var(--nia-surface-soft)] text-[var(--nia-text-muted)]",
    iconClassName: "bg-[var(--nia-surface-soft)] text-[var(--nia-text-muted)]",
    stateSentence: "This circle is complete. Its history is still available.",
  },
};

function GroupIcon({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.8 19c.7-3 2.4-4.6 5.2-4.6s4.5 1.6 5.2 4.6" />
        <path d="M15.5 5.8a2.7 2.7 0 0 1 0 5.1M16.2 14.7c2.1.3 3.4 1.7 4 4.3" />
      </svg>
    </span>
  );
}

function CoinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <ellipse cx="12" cy="6" rx="6.5" ry="3" />
      <path d="M5.5 6v6c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V6M5.5 12v6c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-6" />
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

function CircleStatusBadge({ status }: { status: CircleStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[0.68rem] font-bold tracking-[0.12em] ${STATUS_PRESENTATION[status].badgeClassName}`}>{status}</span>;
}

function CircleMetric({ icon, label, children, emphasized = false }: { icon: ReactNode; label: string; children: ReactNode; emphasized?: boolean }) {
  return (
    <div className={`flex min-w-0 gap-3 ${emphasized ? "md:border-l md:border-[var(--nia-border)] md:pl-7" : ""}`}>
      <span className="mt-0.5 shrink-0 text-[var(--nia-primary)]">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[var(--nia-text-muted)]">{label}</dt>
        <dd className={`mt-1 leading-6 text-[var(--nia-text)] ${emphasized ? "font-semibold" : ""}`}>{children}</dd>
      </div>
    </div>
  );
}

function CircleCard({ circle }: { circle: OwnerCircleIndexItem }) {
  const presentation = STATUS_PRESENTATION[circle.status];
  const round = circle.currentOrNextRound;
  const isCompleted = circle.status === "COMPLETED";

  return (
    <li>
      <article className="rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm transition hover:border-[var(--nia-primary)] hover:shadow-md sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <GroupIcon className={presentation.iconClassName} />
            <div className="min-w-0">
              <CircleStatusBadge status={circle.status} />
              <h2 className="mt-3 font-serif text-2xl tracking-tight text-[var(--nia-text)] sm:text-[1.7rem]">{circle.name}</h2>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-[var(--nia-text-muted)]">{presentation.stateSentence}</p>
            </div>
          </div>
          <Link
            href={`/circles/${circle.id}`}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--nia-primary)] px-4 text-sm font-semibold text-[var(--nia-primary)] transition hover:bg-[var(--nia-active-soft)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]"
          >
            {isCompleted ? "View circle" : "Open circle"}
            <ChevronIcon />
          </Link>
        </div>

        <div className="my-6 border-t border-[var(--nia-border)]" />

        <dl className={`grid gap-5 sm:grid-cols-2 ${round ? "md:grid-cols-3" : "md:max-w-2xl"}`}>
          <CircleMetric icon={<CoinIcon />} label="Contribution">
            {formatContributionMoney(circle.contributionAmount, circle.currency)} · {getFrequencyLabel(circle.frequency)}
          </CircleMetric>
          <CircleMetric icon={<GroupIcon className="size-5 rounded-none bg-transparent" />} label="Members">
            {circle.memberCount}
          </CircleMetric>
          {round ? (
            <CircleMetric icon={<CalendarIcon />} label={round.status === "ACTIVE" ? "Current round" : "Next round"} emphasized>
              <span className="block">{round.roundNumber} · {round.recipientDisplayName}</span>
              <span className="block text-sm font-normal text-[var(--nia-text-muted)]">Scheduled for {formatOwnerDate(round.dueDate)}</span>
            </CircleMetric>
          ) : null}
        </dl>
      </article>
    </li>
  );
}

function CircleEmptyState() {
  return (
    <section className="mt-8 rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-7 text-center shadow-sm sm:p-10">
      <GroupIcon className="mx-auto bg-[var(--nia-active-soft)] text-[var(--nia-primary)]" />
      <h2 className="mt-4 font-serif text-2xl tracking-tight text-[var(--nia-text)]">Start your first SUSU circle</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--nia-text-muted)]">Plan a shared savings rotation, add the people you trust, and set the payout order when you are ready.</p>
      <Link href="/circles/new" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--nia-primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
        Create your first circle
      </Link>
    </section>
  );
}

export function CircleIndex({ circles }: { circles: readonly OwnerCircleIndexItem[] }) {
  const sortedCircles = (["DRAFT", "ACTIVE", "COMPLETED"] as const).flatMap((status) => circles.filter((circle) => circle.status === status));
  const countLabel = `${circles.length} ${circles.length === 1 ? "circle" : "circles"}`;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[var(--nia-app-background)] px-5 py-9 text-[var(--nia-text)] sm:px-8 sm:py-12">
      <div className="relative mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--nia-primary)]">SUSU circles</p>
            <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-[2.8rem]">My SUSU circles</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-[var(--nia-text-muted)]">Manage your circles, see where they stand, and take the next step.</p>
          </div>
          <Link href="/circles/new" className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--nia-primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)] sm:w-auto">
            + Create a circle
          </Link>
        </div>

        {circles.length === 0 ? (
          <CircleEmptyState />
        ) : (
          <>
            <ul className="mt-9 space-y-4 sm:mt-10 sm:space-y-5">
              {sortedCircles.map((circle) => <CircleCard key={circle.id} circle={circle} />)}
            </ul>
            <p className="mt-6 text-sm font-medium text-[var(--nia-text-muted)]">{countLabel}</p>
          </>
        )}
      </div>
    </main>
  );
}
