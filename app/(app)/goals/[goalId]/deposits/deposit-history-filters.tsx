import Link from "next/link";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export type DepositStatusFilter = "all" | "APPROVED" | "PENDING" | "REJECTED";
export type DepositRangeFilter = "all" | "30d" | "90d" | "year";

export function DepositHistoryFilters({
  goalId,
  status,
  range,
  dictionary,
}: {
  goalId: string;
  status: DepositStatusFilter;
  range: DepositRangeFilter;
  dictionary: Dictionary;
}) {
  const copy = dictionary.personalSavings;
  const path = `/goals/${encodeURIComponent(goalId)}/deposits`;

  return (
    <form action={path} className="mt-5 flex flex-col gap-4 rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--nia-text)]" htmlFor="deposit-status">
          {copy.status}
          <select id="deposit-status" name="status" defaultValue={status} className="min-h-11 rounded-xl border border-[var(--nia-border)] bg-[var(--nia-surface)] px-3 text-sm font-normal text-[var(--nia-text)] outline-none transition focus:border-[var(--nia-primary)] focus:ring-2 focus:ring-[var(--nia-active-soft)]">
            <option value="all">{copy.all}</option>
            <option value="APPROVED">{copy.confirmed}</option>
            <option value="PENDING">{copy.awaitingConfirmation}</option>
            <option value="REJECTED">{copy.notConfirmed}</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--nia-text)]" htmlFor="deposit-range">
          {copy.date}
          <select id="deposit-range" name="range" defaultValue={range} className="min-h-11 rounded-xl border border-[var(--nia-border)] bg-[var(--nia-surface)] px-3 text-sm font-normal text-[var(--nia-text)] outline-none transition focus:border-[var(--nia-primary)] focus:ring-2 focus:ring-[var(--nia-active-soft)]">
            <option value="all">{copy.allTime}</option>
            <option value="30d">{copy.last30Days}</option>
            <option value="90d">{copy.last90Days}</option>
            <option value="year">{copy.thisYear}</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--nia-primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)]">
          {copy.apply}
        </button>
        <Link href={path} className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-semibold text-[var(--nia-text-muted)] transition hover:text-[var(--nia-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)]">
          {copy.reset}
        </Link>
      </div>
    </form>
  );
}
