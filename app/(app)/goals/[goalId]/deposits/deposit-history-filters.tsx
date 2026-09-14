import Link from "next/link";

export type DepositStatusFilter = "all" | "APPROVED" | "PENDING" | "REJECTED";
export type DepositRangeFilter = "all" | "30d" | "90d" | "year";

export function DepositHistoryFilters({
  goalId,
  status,
  range,
}: {
  goalId: string;
  status: DepositStatusFilter;
  range: DepositRangeFilter;
}) {
  const path = `/goals/${encodeURIComponent(goalId)}/deposits`;

  return (
    <form action={path} className="mt-5 flex flex-col gap-4 rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface-soft)] p-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--nia-text)]" htmlFor="deposit-status">
          Status
          <select id="deposit-status" name="status" defaultValue={status} className="min-h-11 rounded-xl border border-[var(--nia-border)] bg-[var(--nia-surface)] px-3 text-sm font-normal text-[var(--nia-text)] outline-none transition focus:border-[var(--nia-primary)] focus:ring-2 focus:ring-[var(--nia-active-soft)]">
            <option value="all">All</option>
            <option value="APPROVED">Confirmed</option>
            <option value="PENDING">Awaiting confirmation</option>
            <option value="REJECTED">Not confirmed</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--nia-text)]" htmlFor="deposit-range">
          Date
          <select id="deposit-range" name="range" defaultValue={range} className="min-h-11 rounded-xl border border-[var(--nia-border)] bg-[var(--nia-surface)] px-3 text-sm font-normal text-[var(--nia-text)] outline-none transition focus:border-[var(--nia-primary)] focus:ring-2 focus:ring-[var(--nia-active-soft)]">
            <option value="all">All time</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="year">This year</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--nia-primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--nia-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)]">
          Apply
        </button>
        <Link href={path} className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-semibold text-[var(--nia-text-muted)] transition hover:text-[var(--nia-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nia-primary)]">
          Reset
        </Link>
      </div>
    </form>
  );
}
