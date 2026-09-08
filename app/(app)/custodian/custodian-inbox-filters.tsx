import Link from "next/link";

export type AssignmentStatusFilter = "all" | "PENDING" | "ACTIVE" | "DECLINED" | "CANCELLED" | "ENDED";
export type AssignmentRangeFilter = "all" | "30d" | "90d" | "year";

export function CustodianInboxFilters({
  status,
  range,
}: {
  status: AssignmentStatusFilter;
  range: AssignmentRangeFilter;
}) {
  return (
    <form action="/custodian" className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-[#173c35]" htmlFor="relationship-status">
          Status
          <select id="relationship-status" name="status" defaultValue={status} className="min-h-10 rounded-xl border border-[#c9c5b6] bg-[#fffdf7] px-3 text-sm font-normal text-[#173c35] outline-none focus:border-[#b95035] focus:ring-2 focus:ring-[#f2c9af]">
            <option value="all">All</option>
            <option value="PENDING">Pending</option>
            <option value="ACTIVE">Active</option>
            <option value="DECLINED">Declined</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ENDED">Ended</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-[#173c35]" htmlFor="relationship-range">
          Date
          <select id="relationship-range" name="range" defaultValue={range} className="min-h-10 rounded-xl border border-[#c9c5b6] bg-[#fffdf7] px-3 text-sm font-normal text-[#173c35] outline-none focus:border-[#b95035] focus:ring-2 focus:ring-[#f2c9af]">
            <option value="all">All time</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="year">This year</option>
          </select>
        </label>
      </div>
      <div className="flex gap-3">
        <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#173c35] px-4 text-sm font-semibold text-[#fffaf0] transition hover:bg-[#28564a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b95035]">
          Apply
        </button>
        <Link href="/custodian" className="inline-flex min-h-10 items-center justify-center rounded-full px-3 text-sm font-semibold text-[#5a6b61] transition hover:text-[#173c35] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b95035]">
          Reset
        </Link>
      </div>
    </form>
  );
}
