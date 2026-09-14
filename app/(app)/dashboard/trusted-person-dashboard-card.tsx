import Link from "next/link";

import type { CustodianInboxItem } from "@/src/services/custodian.service";
import type { PendingCustodianDeposit } from "@/src/services/custodian-deposit.service";

type TrustedPersonDashboardCardProps = {
  pendingInvitations: CustodianInboxItem[];
  activeAssignments: CustodianInboxItem[];
  pendingDeposits: PendingCustodianDeposit[];
  hasHistoricalAssignments: boolean;
};

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-7">
      <path d="M12 3.5 19 6v5.3c0 4.3-2.9 7.4-7 9.2-4.1-1.8-7-4.9-7-9.2V6l7-2.5Z" />
      <path d="m8.8 12 2.1 2.1 4.4-4.4" />
    </svg>
  );
}

export function TrustedPersonDashboardCard({
  pendingInvitations,
  activeAssignments,
  pendingDeposits,
  hasHistoricalAssignments,
}: TrustedPersonDashboardCardProps) {
  const waitingCount = pendingInvitations.length + pendingDeposits.length;
  const activeAssignment = activeAssignments[0] ?? null;

  return (
    <section className="mt-8 rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm sm:p-7" aria-labelledby="trusted-person-dashboard-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="trusted-person-dashboard-heading" className="font-serif text-3xl tracking-tight">Trusted person</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">Support others on their savings journey.</p>
        </div>
        <Link href="/custodian" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--nia-primary)] transition hover:text-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
          View all <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="relative mt-6 overflow-hidden rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-active-soft)] p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 hidden size-40 rounded-full border border-[var(--nia-primary)] opacity-10 sm:block" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-xl items-start gap-4">
            <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--nia-surface)] text-[var(--nia-primary)]"><ShieldIcon /></span>
            <div>
              {waitingCount > 0 ? (
                <>
                  <h3 className="font-serif text-xl text-[var(--nia-text)]">{waitingCount} item{waitingCount === 1 ? "" : "s"} waiting for your confirmation.</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">Review the savings requests that need your attention.</p>
                </>
              ) : activeAssignment ? (
                <>
                  <h3 className="font-serif text-xl text-[var(--nia-text)]">You&apos;re helping someone stay on track.</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">{activeAssignment.ownerName} is saving toward {activeAssignment.goal.name}. You&apos;re all caught up for now.</p>
                </>
              ) : hasHistoricalAssignments ? (
                <>
                  <h3 className="font-serif text-xl text-[var(--nia-text)]">Your trusted-person history is here.</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">Past relationships and decisions remain available whenever you need them.</p>
                </>
              ) : (
                <>
                  <h3 className="font-serif text-xl text-[var(--nia-text)]">Nothing waiting for you right now.</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--nia-text-muted)]">You&apos;re all caught up. We&apos;ll let you know when a new confirmation needs your attention.</p>
                </>
              )}
            </div>
          </div>
          <Link href="/custodian" className="relative inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-[var(--nia-primary)] px-5 text-sm font-semibold text-[var(--nia-primary)] transition hover:bg-[var(--nia-surface)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]">
            {waitingCount > 0 ? "Review requests" : "People grow stronger together."} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
