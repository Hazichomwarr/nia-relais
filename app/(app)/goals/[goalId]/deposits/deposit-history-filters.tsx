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
    <form action={path} className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#dfd2c1] bg-[#fffaf2] p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-[#173b32]" htmlFor="deposit-status">
          Status
          <select id="deposit-status" name="status" defaultValue={status} className="min-h-10 rounded-xl border border-[#d8cec0] bg-white px-3 text-sm font-normal text-[#173b32] outline-none focus:border-[#b96549] focus:ring-2 focus:ring-[#f2d2bd]">
            <option value="all">All</option>
            <option value="APPROVED">Confirmed</option>
            <option value="PENDING">Awaiting confirmation</option>
            <option value="REJECTED">Not confirmed</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-[#173b32]" htmlFor="deposit-range">
          Date
          <select id="deposit-range" name="range" defaultValue={range} className="min-h-10 rounded-xl border border-[#d8cec0] bg-white px-3 text-sm font-normal text-[#173b32] outline-none focus:border-[#b96549] focus:ring-2 focus:ring-[#f2d2bd]">
            <option value="all">All time</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="year">This year</option>
          </select>
        </label>
      </div>
      <div className="flex gap-3">
        <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#173b32] px-4 text-sm font-semibold text-[#fffaf2] transition hover:bg-[#28564a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">
          Apply
        </button>
        <Link href={path} className="inline-flex min-h-10 items-center justify-center rounded-full px-3 text-sm font-semibold text-[#587066] transition hover:text-[#173b32] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">
          Reset
        </Link>
      </div>
    </form>
  );
}
