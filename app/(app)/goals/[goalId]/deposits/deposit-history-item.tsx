import type { DepositHistoryItem as DepositHistoryItemModel } from "@/src/services/deposit.service";
import Link from "next/link";

import {
  formatDepositAmount,
  formatDepositDate,
  getDepositStatusPresentation,
} from "./deposit-display";

export default function DepositHistoryItem({
  deposit,
  currency,
}: {
  deposit: DepositHistoryItemModel;
  currency: string;
}) {
  const status = getDepositStatusPresentation(deposit);

  return (
    <li>
      <Link
        href={`/goals/${encodeURIComponent(deposit.goalId)}/deposits/${encodeURIComponent(deposit.id)}`}
        className="group grid min-h-20 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface)] px-4 py-3 shadow-sm transition hover:border-[var(--nia-primary)] hover:bg-[var(--nia-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)] sm:grid-cols-[3rem_minmax(0,1fr)_auto_auto] sm:gap-4 sm:px-5"
      >
        <span aria-hidden="true" className={`inline-flex size-10 items-center justify-center rounded-full ${getStatusIconClassName(deposit.status)}`}>
          <StatusIcon status={deposit.status} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[var(--nia-text)] sm:text-lg">
            {formatDepositAmount(deposit.amount, currency)}
          </p>
          <time className="mt-0.5 block text-sm text-[var(--nia-text-muted)]" dateTime={deposit.depositDate}>
            {formatDepositDate(deposit.depositDate)}
          </time>
        </div>
        <span className={`hidden shrink-0 rounded-full px-3 py-1.5 text-xs font-bold sm:inline-flex ${status.className}`}>
          {status.label}
        </span>
        <span aria-hidden="true" className="text-lg text-[var(--nia-text-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--nia-primary)]">›</span>
        <span className={`col-start-2 w-fit rounded-full px-2.5 py-1 text-[0.7rem] font-bold sm:hidden ${status.className}`}>
          {status.label}
        </span>
      </Link>
    </li>
  );
}

function getStatusIconClassName(status: DepositHistoryItemModel["status"]) {
  if (status === "APPROVED") return "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]";
  if (status === "PENDING") return "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]";
  return "bg-[var(--nia-draft-soft)] text-[var(--nia-secondary)]";
}

function StatusIcon({ status }: { status: DepositHistoryItemModel["status"] }) {
  if (status === "APPROVED") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5"><path d="m6.5 12.5 3.2 3.2 7.8-7.8" /></svg>;
  }

  if (status === "PENDING") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-5"><circle cx="12" cy="12" r="7.5" /><path d="M12 7.8v4.5l3 1.8" /></svg>;
  }

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5"><circle cx="12" cy="12" r="7.5" /><path d="m9.3 9.3 5.4 5.4m0-5.4-5.4 5.4" /></svg>;
}
