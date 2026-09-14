import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries/types";

export function formatDate(value: string | Date, locale: Locale) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value;
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
    PENDING: dictionary.status.pending,
    APPROVED: dictionary.status.approved,
    REJECTED: dictionary.status.rejected,
  };

  return labels[status] ?? status;
}
