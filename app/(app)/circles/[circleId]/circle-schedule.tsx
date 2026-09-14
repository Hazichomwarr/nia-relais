import type { ActiveCircleOwnerRoundResult } from "@/src/services/circle-active-owner.service";
import type { OwnerPayoutsRoundResult } from "@/src/services/payout-owner-read.service";

import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";

type ScheduleRound = ActiveCircleOwnerRoundResult | OwnerPayoutsRoundResult;

function getRecipient(round: ScheduleRound) {
  return "recipientDisplayName" in round ? round.recipientDisplayName : round.recipient.displayName;
}

export function CircleSchedule({ rounds }: { rounds: readonly ScheduleRound[] }) {
  return (
    <section className="w-full min-w-0 max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circle</p>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-[#173b32] sm:text-4xl">Schedule</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#587066]">This is the persisted rotation. Dates and recipients stay fixed as the circle progresses.</p>
      <ol className="mt-7 divide-y divide-[#e2d7c9] border-y border-[#e2d7c9]">
        {rounds.map((round) => {
          const badge = getRoundStatusBadge(round.status);
          return <li key={round.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 py-4 sm:flex sm:items-center"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f3ede3] text-sm font-bold text-[#587066]">{round.roundNumber}</span><div className="min-w-0"><p className="break-words font-semibold text-[#173b32]">{getRecipient(round)}</p><p className="mt-1 text-sm text-[#587066]">{formatOwnerDate(round.dueDate)}</p></div><span className={`col-start-2 w-fit rounded-full px-3 py-1 text-xs font-semibold ${badge.className} sm:col-auto sm:ml-auto`}>{badge.label}</span></li>;
        })}
      </ol>
    </section>
  );
}
