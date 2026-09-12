import type { ActiveCircleOwnerRoundResult } from "@/src/services/circle-active-owner.service";
import type { OwnerPayoutsRoundResult } from "@/src/services/payout-owner-read.service";

import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";

type ScheduleRound = ActiveCircleOwnerRoundResult | OwnerPayoutsRoundResult;

function getRecipient(round: ScheduleRound) {
  return "recipientDisplayName" in round ? round.recipientDisplayName : round.recipient.displayName;
}

export function CircleSchedule({ rounds }: { rounds: readonly ScheduleRound[] }) {
  return (
    <section className="max-w-3xl rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h1 className="font-serif text-3xl tracking-tight">Schedule</h1>
      <p className="mt-3 text-sm leading-6 text-[#587066]">This rotation comes from the persisted circle schedule. Dates and recipients do not change as the circle progresses.</p>
      <ol className="mt-6 divide-y divide-[#efe6d8]">
        {rounds.map((round) => {
          const badge = getRoundStatusBadge(round.status);
          return <li key={round.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-[#173b32]">Round {round.roundNumber} · {getRecipient(round)}</p><p className="mt-1 text-sm text-[#587066]">{formatOwnerDate(round.dueDate)}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</span></li>;
        })}
      </ol>
    </section>
  );
}
