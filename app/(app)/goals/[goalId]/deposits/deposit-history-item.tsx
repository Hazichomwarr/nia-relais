import type { DepositHistoryItem as DepositHistoryItemModel } from "@/src/services/deposit.service";
import type { Locale } from "@/src/i18n/config";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import Link from "next/link";

import {
  formatDepositAmount,
  formatDepositDate,
  getDepositStatusPresentation,
} from "./deposit-display";

export default function DepositHistoryItem({
  deposit,
  currency,
  dictionary,
  locale,
}: {
  deposit: DepositHistoryItemModel;
  currency: string;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const status = getDepositStatusPresentation(deposit, dictionary);

  return (
    <li className="border-b border-[var(--nia-border)] last:border-b-0">
      <Link
        href={`/goals/${encodeURIComponent(deposit.goalId)}/deposits/${encodeURIComponent(deposit.id)}`}
        className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-[var(--nia-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nia-primary)] sm:min-h-[4.5rem] sm:px-5"
      >
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[var(--nia-text)] sm:text-lg">
            {formatDepositAmount(deposit.amount, currency)}
          </p>
          <time className="mt-0.5 block text-sm text-[var(--nia-text-muted)]" dateTime={deposit.depositDate}>
            {formatDepositDate(deposit.depositDate, locale)}
          </time>
        </div>
        <span className={`hidden shrink-0 rounded-full px-3 py-1.5 text-xs font-bold sm:inline-flex ${status.className}`}>
          {status.label}
        </span>
        <span className={`w-fit rounded-full px-2.5 py-1 text-[0.7rem] font-bold sm:hidden ${status.className}`}>
          {status.label}
        </span>
      </Link>
    </li>
  );
}
