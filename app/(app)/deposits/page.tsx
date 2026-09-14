import Link from "next/link";

import { requireUser } from "@/src/auth/require-user";
import { getDictionary } from "@/src/i18n/get-dictionary";
import { getLocale } from "@/src/i18n/locale";
import { getPersonalGoalsForDashboard } from "@/src/services/goal.service";

function formatAmount(amount: string, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

export default async function DepositsPage() {
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const dictionary = getDictionary(locale);
  const copy = dictionary.personalSavings;
  const goals = await getPersonalGoalsForDashboard(user);

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#b96549]">{dictionary.common.mySavings}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#173b32] sm:text-4xl">
          {copy.indexTitle}
        </h1>
        <p className="mt-3 text-base leading-7 text-[#587066]">
          {copy.indexDescription}
        </p>
      </div>

      {goals.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-[#ded5c6] bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-[#173b32]">{copy.noRecords}</h2>
          <p className="mt-2 max-w-lg leading-7 text-[#587066]">
            {copy.noRecordsDescription}
          </p>
          <Link
            href="/goals/new"
            className="mt-5 inline-flex rounded-full bg-[#b96549] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#9f4e34] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
          >
            {copy.createGoal}
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {goals.map((goal) => {
            const hasConfirmedSavings = goal.savedAmount !== "0.00";

            return (
              <article
                key={goal.id}
                className="flex flex-col gap-4 rounded-2xl border border-[#ded5c6] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-[#173b32]">{goal.name}</h2>
                  <p className="mt-1 text-sm text-[#587066]">
                    {copy.weeklyAmount}: {formatAmount(goal.weeklyAmount, goal.currency)}
                  </p>
                  <p className="mt-2 text-sm font-medium text-[#285448]">
                    {hasConfirmedSavings
                      ? `${copy.confirmedSavings}: ${formatAmount(goal.savedAmount, goal.currency)}`
                      : copy.noConfirmedSavings}
                  </p>
                </div>
                <Link
                  href={`/goals/${encodeURIComponent(goal.id)}/deposits`}
                  className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#b96549] px-4 py-2 text-sm font-semibold text-[#9f4e34] transition-colors hover:bg-[#fff1e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
                >
                  {copy.viewSavings}
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
