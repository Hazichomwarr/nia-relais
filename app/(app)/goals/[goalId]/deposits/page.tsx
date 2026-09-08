import { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  GoalNotFoundOrUnauthorizedError,
  requireGoalOwner,
} from "@/src/auth/require-goal-owner";
import {
  getDepositHistoryForGoal,
  type DepositHistoryItem,
} from "@/src/services/deposit.service";
import DepositHistoryItemCard from "./deposit-history-item";
import {
  DepositHistoryFilters,
  type DepositRangeFilter,
  type DepositStatusFilter,
} from "./deposit-history-filters";

type DepositSearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusFilters = new Set<DepositStatusFilter>(["all", "APPROVED", "PENDING", "REJECTED"]);
const rangeFilters = new Set<DepositRangeFilter>(["all", "30d", "90d", "year"]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatusFilter(value: string | string[] | undefined): DepositStatusFilter {
  const candidate = firstValue(value);
  return candidate && statusFilters.has(candidate as DepositStatusFilter)
    ? candidate as DepositStatusFilter
    : "all";
}

function parseRangeFilter(value: string | string[] | undefined): DepositRangeFilter {
  const candidate = firstValue(value);
  return candidate && rangeFilters.has(candidate as DepositRangeFilter)
    ? candidate as DepositRangeFilter
    : "all";
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateIsInRange(value: string, range: DepositRangeFilter) {
  if (range === "all") return true;

  const now = new Date();
  const depositDate = toUtcDate(value);

  if (range === "year") {
    return depositDate >= new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }

  const days = range === "30d" ? 30 : 90;
  const minimum = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return depositDate >= minimum;
}

function filterDeposits(
  deposits: DepositHistoryItem[],
  status: DepositStatusFilter,
  range: DepositRangeFilter,
) {
  return deposits.filter(
    (deposit) => (status === "all" || deposit.status === status) && dateIsInRange(deposit.depositDate, range),
  );
}

export default async function DepositHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ goalId: string }>;
  searchParams: DepositSearchParams;
}) {
  const [{ goalId }, rawSearchParams] = await Promise.all([params, searchParams]);
  const status = parseStatusFilter(rawSearchParams.status);
  const range = parseRangeFilter(rawSearchParams.range);
  let authority;

  try {
    authority = await requireGoalOwner(goalId);
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) notFound();
    throw error;
  }

  const { goal } = authority;
  const deposits = await getDepositHistoryForGoal(goal.id);
  const filteredDeposits = filterDeposits(deposits, status, range);
  const confirmedDeposits = deposits.filter((deposit) => deposit.status === "APPROVED");
  const pendingDeposits = deposits.filter((deposit) => deposit.status === "PENDING");
  const rejectedDeposits = deposits.filter((deposit) => deposit.status === "REJECTED");
  const confirmedTotal = confirmedDeposits
    .reduce((total, deposit) => total.plus(deposit.amount), new Prisma.Decimal(0))
    .toFixed(2);

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">Savings record</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{goal.name}</h1>
            <p className="mt-3 text-base leading-7 text-[#587066]">
              {formatAmount(goal.weeklyAmount.toFixed(2), goal.currency)} committed each week
            </p>
          </div>

          {goal.status === "ACTIVE" ? (
            <Link
              href={`/goals/${encodeURIComponent(goal.id)}/deposits/new`}
              className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-[#b96549] px-5 font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
            >
              Record savings
            </Link>
          ) : null}
        </header>

        <dl className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric label="Confirmed" value={confirmedDeposits.length} />
          <SummaryMetric label="Awaiting confirmation" value={pendingDeposits.length} />
          <SummaryMetric label="Not confirmed" value={rejectedDeposits.length} />
          <SummaryMetric label="Confirmed total" value={formatAmount(confirmedTotal, goal.currency)} />
        </dl>

        {deposits.length === 0 ? (
          <section className="mt-10 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fff8ed] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight">You haven&apos;t recorded any savings yet.</h2>
            <p className="mt-3 text-base leading-7 text-[#587066]">Your record will appear here when you add one.</p>
            {goal.status === "ACTIVE" ? (
              <Link
                href={`/goals/${encodeURIComponent(goal.id)}/deposits/new`}
                className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
              >
                Record savings
              </Link>
            ) : null}
          </section>
        ) : (
          <section className="mt-10" aria-labelledby="savings-history-heading">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">Your savings</p>
            <h2 id="savings-history-heading" className="mt-2 text-2xl font-semibold tracking-tight">A record of every step.</h2>
            <DepositHistoryFilters goalId={goal.id} status={status} range={range} />

            {filteredDeposits.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-[#dfd2c1] bg-[#fffaf2] p-5 text-sm leading-6 text-[#587066]">
                {status === "PENDING" && range === "all"
                  ? "No savings are waiting for confirmation."
                  : "No savings match these filters."}
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {filteredDeposits.map((deposit) => (
                  <DepositHistoryItemCard key={deposit.id} deposit={deposit} currency={goal.currency} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-[#dfd2c1] bg-[#fffaf2] px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7b8179]">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-[#173b32]">{value}</dd>
    </div>
  );
}

function formatAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}
