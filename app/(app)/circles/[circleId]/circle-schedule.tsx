import type { ActiveCircleOwnerRoundResult } from "@/src/services/circle-active-owner.service";
import type { OwnerPayoutsRoundResult } from "@/src/services/payout-owner-read.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import { formatDate } from "@/src/i18n/format";


type ScheduleRound = ActiveCircleOwnerRoundResult | OwnerPayoutsRoundResult;

function getRecipient(round: ScheduleRound) {
  return "recipientDisplayName" in round ? round.recipientDisplayName : round.recipient.displayName;
}

export function CircleSchedule({ rounds, dictionary, locale }: { rounds: readonly ScheduleRound[]; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.susuWorkspace;
  const roundStatus = (status: string) => status === "ACTIVE" ? copy.active : status === "CLOSED" ? copy.closed : copy.upcoming;
  return (
    <section className="w-full min-w-0 max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{dictionary.susu.eyebrow}</p>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-[#173b32] sm:text-4xl">{copy.schedule}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#587066]">{copy.scheduleDescription}</p>
      <ol className="mt-7 divide-y divide-[#e2d7c9] border-y border-[#e2d7c9]">
        {rounds.map((round) => {
          const className = round.status === "ACTIVE" ? "bg-[#e6f0e8] text-[#35634f]" : round.status === "CLOSED" ? "bg-[#efe7db] text-[#587066]" : "bg-[#fff0d9] text-[#8a5b27]";
          return <li key={round.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 py-4 sm:flex sm:items-center"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f3ede3] text-sm font-bold text-[#587066]">{round.roundNumber}</span><div className="min-w-0"><p className="break-words font-semibold text-[#173b32]">{getRecipient(round)}</p><p className="mt-1 text-sm text-[#587066]">{copy.dueDate}: {formatDate(round.dueDate, locale)}</p></div><span className={`col-start-2 w-fit rounded-full px-3 py-1 text-xs font-semibold ${className} sm:col-auto sm:ml-auto`}>{roundStatus(round.status)}</span></li>;
        })}
      </ol>
    </section>
  );
}
