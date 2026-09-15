import type {
  MemberDashboardResult,
  MemberObligationResult,
  MemberPayoutResult,
  RoundScheduleEntry,
} from "@/src/services/circle-member-dashboard.service";
import type { Locale } from "@/src/i18n/config";

// Pure, framework-free presentation logic -- no React, no "use client",
// nothing async. This module only formats and labels values the 7H.2
// service already computed and serialized; it never recalculates a
// financial amount (see formatCircleMoney -- it only groups/pads an
// already-fixed-decimal string) and never infers a state the service
// didn't already decide (see selectRoundHeading/getPayoutPresentation --
// both branch on the service's own fields, not on independent guesses).

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Every week",
  BIWEEKLY: "Every two weeks",
  MONTHLY: "Every month",
};

export function getFrequencyLabel(frequency: string, locale: Locale = "en"): string {
  if (locale === "fr") return ({ WEEKLY: "Chaque semaine", BIWEEKLY: "Toutes les deux semaines", MONTHLY: "Chaque mois" }[frequency] ?? frequency);
  return FREQUENCY_LABELS[frequency] ?? frequency;
}

const CIRCLE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

export function getCircleStatusLabel(status: string): string {
  return CIRCLE_STATUS_LABELS[status] ?? status;
}

export type BadgePresentation = {
  readonly label: string;
  readonly className: string;
};

const CONFIRMED_BADGE_CLASS = "bg-[#e6f0e8] text-[#35634f]";
const PENDING_BADGE_CLASS = "bg-[#fff0d9] text-[#8a5b27]";
const NEUTRAL_BADGE_CLASS = "bg-[#efe7db] text-[#587066]";
const NEGATIVE_BADGE_CLASS = "bg-[#f4e6e1] text-[#8d4f42]";
// 9G: a deliberately distinct, quiet sage -- never the same green as a
// real NIA-managed closure/confirmation, never a warning/red treatment.
const IMPORTED_BADGE_CLASS = "bg-[#e3e8df] text-[#4f6354]";

/**
 * 9G: `closureBasis`, when supplied, is the presentation authority for a
 * CLOSED round that is actually the owner's own historical declaration at
 * import time -- never a normal NIA-managed closure. Every other status is
 * unchanged from the 7H.3 wording.
 */
export function getRoundStatusPresentation(status: string, closureBasis?: string): BadgePresentation {
  if (status === "CLOSED" && closureBasis === "IMPORTED_DECLARATION") {
    return { label: "Imported history", className: IMPORTED_BADGE_CLASS };
  }
  if (status === "ACTIVE") return { label: "Active", className: CONFIRMED_BADGE_CLASS };
  if (status === "CLOSED") return { label: "Closed", className: NEUTRAL_BADGE_CLASS };
  return { label: "Upcoming", className: PENDING_BADGE_CLASS };
}

/**
 * 9G: `fulfillmentBasis` is the presentation authority for the one case
 * the `fulfilled` boolean alone must never speak for -- an obligation the
 * owner declared fulfilled as part of the circle's imported history, with
 * no real ContributionPayment behind it. It is worded and branded
 * distinctly ("Imported history"), never "Fulfilled" (which would imply a
 * real NIA-confirmed payment) and never "Outstanding" (which would falsely
 * suggest money is still owed on an already-closed historical round).
 */
export function getObligationStatusPresentation(
  obligation: Pick<MemberObligationResult, "fulfilled" | "fulfillmentBasis">,
): BadgePresentation {
  if (obligation.fulfillmentBasis === "IMPORTED_DECLARATION") {
    return { label: "Imported history", className: IMPORTED_BADGE_CLASS };
  }
  return obligation.fulfilled
    ? { label: "Fulfilled", className: CONFIRMED_BADGE_CLASS }
    : { label: "Outstanding", className: PENDING_BADGE_CLASS };
}

/**
 * Wording exactly per the 7H.3 spec. Branches ONLY on payout.status (or
 * null) -- never on round status, and RECORDED is never described as
 * confirmed receipt.
 *
 * 9G: `confirmationBasis` is the presentation authority for the one case a
 * member must never see worded as their own action -- a CONFIRMED payout
 * whose confirmationBasis is IMPORTED_DECLARATION means the owner declared
 * it when importing the circle; this member never confirmed anything
 * through NIA for it, even for their own historical round.
 */
export function getPayoutPresentation(payout: MemberPayoutResult): BadgePresentation & { description: string } {
  if (!payout) {
    return { label: "Not yet recorded", description: "Not yet recorded.", className: NEUTRAL_BADGE_CLASS };
  }
  if (payout.status === "CONFIRMED" && payout.confirmationBasis === "IMPORTED_DECLARATION") {
    return {
      label: "Imported history",
      description: "Reported when this circle was imported into NIA.",
      className: IMPORTED_BADGE_CLASS,
    };
  }
  if (payout.status === "RECORDED") {
    return {
      label: "Awaiting your confirmation",
      description: "Recorded by the circle owner — awaiting your confirmation.",
      className: PENDING_BADGE_CLASS,
    };
  }
  if (payout.status === "CONFIRMED") {
    return { label: "Receipt confirmed", description: "Receipt confirmed.", className: CONFIRMED_BADGE_CLASS };
  }
  return { label: "Receipt disputed", description: "Receipt disputed.", className: NEGATIVE_BADGE_CLASS };
}

/**
 * Formats an already-fixed-decimal string (e.g. "1234.50", produced by the
 * service's own Prisma.Decimal.toFixed(2)) for display -- grouping and
 * padding only, never re-parsing into a number and recalculating.
 */
export function formatCircleMoney(value: string, currency: string): string {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;
  return `${currency} ${groupedWhole}${displayedFraction}`;
}

function toUtcDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatCircleDate(value: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDateOnly(value));
}

export function formatCircleDateTime(value: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export type RoundHeading =
  | { readonly kind: "current"; readonly round: RoundScheduleEntry }
  | { readonly kind: "next"; readonly round: RoundScheduleEntry }
  | { readonly kind: "historical" }
  | { readonly kind: "none" };

/**
 * Chooses WORDING for whichever round the service already selected -- it
 * makes no independent judgment about round eligibility. currentRound and
 * nextRound are mutually exclusive by construction in the service, so at
 * most one of the first two branches can match.
 */
export function selectRoundHeading(
  dashboard: Pick<MemberDashboardResult, "currentRound" | "nextRound" | "circle">,
): RoundHeading {
  if (dashboard.currentRound) return { kind: "current", round: dashboard.currentRound };
  if (dashboard.nextRound) return { kind: "next", round: dashboard.nextRound };
  if (dashboard.circle.status === "COMPLETED" || dashboard.circle.status === "ARCHIVED") {
    return { kind: "historical" };
  }
  return { kind: "none" };
}

export function isMemberRecipientRound(
  round: Pick<RoundScheduleEntry, "roundNumber">,
  payoutOrder: number | null,
): boolean {
  return payoutOrder !== null && round.roundNumber === payoutOrder;
}
