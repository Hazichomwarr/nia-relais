import type { DepositHistoryItem as DepositHistoryItemModel } from "@/src/services/deposit.service";
import Link from "next/link";

import {
  formatDepositAmount,
  formatDepositDate,
  getDepositStatusPresentation,
} from "./deposit-display";

export default function DepositHistoryItem({
  deposit,
  currency,
}: {
  deposit: DepositHistoryItemModel;
  currency: string;
}) {
  const status = getDepositStatusPresentation(deposit);

  return (
    <article>
      <Link
        href={`/goals/${encodeURIComponent(deposit.goalId)}/deposits/${encodeURIComponent(deposit.id)}`}
        className="block rounded-[1.5rem] border border-[#dfd2c1] bg-[#fffdf8] p-5 shadow-[0_8px_30px_rgba(77,57,40,0.06)] transition hover:border-[#c9af95] hover:shadow-[0_10px_34px_rgba(77,57,40,0.1)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xl font-semibold tracking-tight text-[#173b32]">
              {formatDepositAmount(deposit.amount, currency)}
            </p>
            <time className="mt-1 block text-sm text-[#7b8179]" dateTime={deposit.depositDate}>
              Recorded on {formatDepositDate(deposit.depositDate)}
            </time>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
            {status.label}
          </span>
        </div>

        {deposit.note ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-[#587066]">{deposit.note}</p> : null}
        <span className="mt-4 inline-block text-sm font-semibold text-[#a95f45]">View record</span>
      </Link>
    </article>
  );
}
