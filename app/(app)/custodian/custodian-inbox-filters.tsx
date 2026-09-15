import Link from "next/link";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export type AssignmentStatusFilter = "all" | "PENDING" | "ACTIVE" | "DECLINED" | "CANCELLED" | "ENDED";
export type AssignmentRangeFilter = "all" | "30d" | "90d" | "year";

export function CustodianInboxFilters({
  status,
  range,
  dictionary,
}: {
  status: AssignmentStatusFilter;
  range: AssignmentRangeFilter;
  dictionary: Dictionary;
}) {
  const copy = dictionary.custodian;
  return (
    <form action="/custodian" className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-[#173c35]" htmlFor="relationship-status">
          {copy.status}
          <select id="relationship-status" name="status" defaultValue={status} className="min-h-10 rounded-xl border border-[#c9c5b6] bg-[#fffdf7] px-3 text-sm font-normal text-[#173c35] outline-none focus:border-[#b95035] focus:ring-2 focus:ring-[#f2c9af]">
            <option value="all">{copy.all}</option><option value="PENDING">{copy.pending}</option><option value="ACTIVE">{copy.active}</option><option value="DECLINED">{copy.declined}</option><option value="CANCELLED">{copy.cancelled}</option><option value="ENDED">{copy.ended}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-[#173c35]" htmlFor="relationship-range">
          {copy.date}
          <select id="relationship-range" name="range" defaultValue={range} className="min-h-10 rounded-xl border border-[#c9c5b6] bg-[#fffdf7] px-3 text-sm font-normal text-[#173c35] outline-none focus:border-[#b95035] focus:ring-2 focus:ring-[#f2c9af]">
            <option value="all">{copy.allTime}</option><option value="30d">{copy.last30Days}</option><option value="90d">{copy.last90Days}</option><option value="year">{copy.thisYear}</option>
          </select>
        </label>
      </div>
      <div className="flex gap-3">
        <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#173c35] px-4 text-sm font-semibold text-[#fffaf0] transition hover:bg-[#28564a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b95035]">
          {copy.apply}
        </button>
        <Link href="/custodian" className="inline-flex min-h-10 items-center justify-center rounded-full px-3 text-sm font-semibold text-[#5a6b61] transition hover:text-[#173c35] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b95035]">
          {copy.reset}
        </Link>
      </div>
    </form>
  );
}
