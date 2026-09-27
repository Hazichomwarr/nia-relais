"use client";

import { useState } from "react";

import type { DepositHistoryItem } from "@/src/services/deposit.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

import { getHistoryDisclosure } from "./deposit-history-disclosure";
import DepositHistoryItemCard from "./deposit-history-item";

export function DepositHistoryList({
  deposits,
  currency,
  dictionary,
  locale,
  filterKey,
}: {
  deposits: readonly DepositHistoryItem[];
  currency: string;
  dictionary: Dictionary;
  locale: Locale;
  filterKey: string;
}) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === filterKey;
  const disclosure = getHistoryDisclosure(deposits, expanded);
  const copy = dictionary.personalSavings;
  const countLabel = deposits.length === 1 ? copy.savingRecordedOne : copy.savingsRecordedMany;

  return (
    <div className="mt-6">
      <p className="text-sm font-medium text-[var(--nia-text-muted)]">
        {countLabel.replace("{count}", String(deposits.length))}
      </p>
      <ul id="savings-history-list" className="mt-3 overflow-hidden rounded-2xl border border-[var(--nia-border)] bg-[var(--nia-surface)]" aria-label={copy.savingsHistory}>
        {disclosure.visibleRecords.map((deposit) => <DepositHistoryItemCard key={deposit.id} deposit={deposit} currency={currency} dictionary={dictionary} locale={locale} />)}
      </ul>
      {disclosure.hasHiddenRecords ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="savings-history-list"
          onClick={() => setExpandedFor(expanded ? null : filterKey)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-[var(--nia-primary)] transition hover:bg-[var(--nia-active-soft)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--nia-primary)]"
        >
          {expanded ? copy.showLess : copy.viewMoreSavings.replace("{count}", String(disclosure.hiddenCount))}
        </button>
      ) : null}
    </div>
  );
}
