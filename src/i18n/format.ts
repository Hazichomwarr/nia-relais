import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries/types";

export function getCurrencyDisplayCode(currency: string) {
  return currency === "XOF" ? "CFA" : currency;
}

export function formatMoney(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;
  return `${getCurrencyDisplayCode(currency)} ${groupedWhole}${displayedFraction}`;
}

export function formatDate(value: string | Date, locale: Locale) {
  // Date-only values are persisted calendar dates and must be parsed in UTC.
  // Owner SUSU reads also intentionally serialize lifecycle/schedule instants
  // as full ISO strings; appending a second time portion to those made an
  // invalid Date (for example, `...Z T00:00:00.000Z`) at the Intl boundary.
  const date = typeof value === "string"
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value)
    : value;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" }).format(date);
}

export function getFrequencyLabel(frequency: string, locale: Locale) {
  const labels = locale === "fr" ? { WEEKLY: "chaque semaine", BIWEEKLY: "toutes les deux semaines", MONTHLY: "chaque mois" } : { WEEKLY: "every week", BIWEEKLY: "every two weeks", MONTHLY: "every month" };
  return labels[frequency as keyof typeof labels] ?? frequency;
}

export function getStatusLabel(status: string, dictionary: Dictionary) {
  const labels: Record<string, string> = {
    ACTIVE: dictionary.status.active,
    DRAFT: dictionary.status.draft,
    COMPLETED: dictionary.status.completed,
    CANCELLED: dictionary.status.cancelled,
    ARCHIVED: dictionary.status.archived,
    ABANDONED: dictionary.status.abandoned,
    PENDING: dictionary.status.pending,
    APPROVED: dictionary.status.approved,
    REJECTED: dictionary.status.rejected,
  };

  return labels[status] ?? status;
}
