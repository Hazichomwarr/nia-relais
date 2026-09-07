import Link from "next/link";
import { notFound } from "next/navigation";

import {
  GoalNotFoundOrUnauthorizedError,
  requireGoalOwner,
} from "@/src/auth/require-goal-owner";
import { getDepositHistoryForGoal } from "@/src/services/deposit.service";
import DepositHistoryItem from "./deposit-history-item";

export default async function DepositHistoryPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const { goalId } = await params;
  let authority;

  try {
    authority = await requireGoalOwner(goalId);
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) notFound();
    throw error;
  }

  const { goal } = authority;
  const deposits = await getDepositHistoryForGoal(goal.id);

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

        {deposits.length === 0 ? (
          <section className="mt-10 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fff8ed] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight">You haven&apos;t recorded any savings for this goal yet.</h2>
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
            <h2 id="savings-history-heading" className="text-xl font-semibold tracking-tight">Your savings</h2>
            <div className="mt-5 space-y-4">
              {deposits.map((deposit) => (
                <DepositHistoryItem key={deposit.id} deposit={deposit} currency={goal.currency} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function formatAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}
