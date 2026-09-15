import type { DepositHistoryItem } from "@/src/services/deposit.service";
import type { Locale } from "@/src/i18n/config";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import { formatDate, formatMoney } from "@/src/i18n/format";

export function getDepositStatusPresentation(deposit: DepositHistoryItem, dictionary: Dictionary) {
  const copy = dictionary.personalSavings;
  if (deposit.status === "APPROVED") {
    return {
      label: copy.confirmed,
      description: copy.approvedStatusDescription,
      className: "bg-[var(--nia-active-soft)] text-[var(--nia-primary)]",
    };
  }

  if (deposit.status === "PENDING") {
    return {
      label: copy.awaitingConfirmation,
      description: copy.pendingStatusDescription,
      className: "bg-[var(--nia-draft-soft)] text-[var(--nia-draft-accent)]",
    };
  }

  return {
    label: copy.notConfirmed,
    description: copy.rejectedStatusDescription,
    className: "bg-[var(--nia-draft-soft)] text-[var(--nia-secondary)]",
  };
}

export function formatDepositAmount(value: string, currency: string) {
  return formatMoney(value, currency);
}

export function formatDepositDate(value: string, locale: Locale) {
  return formatDate(value, locale);
}

export function formatDecisionDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
