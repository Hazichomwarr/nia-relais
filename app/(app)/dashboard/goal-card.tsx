import type { PersonalGoalDashboardSummary } from "@/src/services/goal.service";

export function GoalCard({
  goal,
  subdued = false,
}: {
  goal: PersonalGoalDashboardSummary;
  subdued?: boolean;
}) {
  const isArchived = goal.status === "ARCHIVED";

  return (
    <article
      className={`rounded-[1.5rem] border p-5 shadow-[0_8px_30px_rgba(77,57,40,0.06)] ${
        isArchived
          ? "border-[#e5ddd1] bg-[#f5f0e7] text-[#7b8179]"
          : subdued
            ? "border-[#e1d9cd] bg-[#fffaf2] text-[#587066]"
            : "border-[#dfd2c1] bg-[#fffdf8] text-[#173b32]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold leading-7 text-[#173b32]">{goal.name}</h3>
        {goal.status !== "ACTIVE" ? (
          <span className="shrink-0 rounded-full bg-[#eee5d8] px-3 py-1 text-xs font-semibold text-[#7b8179]">
            {goal.status === "COMPLETED" ? "Completed" : "Archived"}
          </span>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-[#173b32]">
            {formatGoalAmount(goal.weeklyAmount, goal.currency)}
            <span className="ml-1 text-sm font-medium text-[#7b8179]">/ week</span>
          </p>
          <p className="mt-1 text-sm text-[#7b8179]">Target: {formatGoalAmount(goal.targetAmount, goal.currency)}</p>
        </div>

        <div className="border-t border-[#e8dfd3] pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Unlocks</p>
          <time className="mt-1 block text-sm font-medium" dateTime={goal.unlockDate}>
            {formatGoalDate(goal.unlockDate)}
          </time>
        </div>
      </div>
    </article>
  );
}

function formatGoalAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}

function formatGoalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
