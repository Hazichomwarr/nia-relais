import type {
  MemberDashboardResult,
  MemberObligationResult,
  MemberPayoutResult,
  RoundScheduleEntry,
} from "@/src/services/circle-member-dashboard.service";

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

export function getFrequencyLabel(frequency: string): string {
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

export function getRoundStatusPresentation(status: string): BadgePresentation {
  if (status === "ACTIVE") return { label: "Active", className: CONFIRMED_BADGE_CLASS };
  if (status === "CLOSED") return { label: "Closed", className: NEUTRAL_BADGE_CLASS };
  return { label: "Upcoming", className: PENDING_BADGE_CLASS };
}

export function getObligationStatusPresentation(
  obligation: Pick<MemberObligationResult, "fulfilled">,
): BadgePresentation {
  return obligation.fulfilled
    ? { label: "Fulfilled", className: CONFIRMED_BADGE_CLASS }
    : { label: "Outstanding", className: PENDING_BADGE_CLASS };
}

/**
 * Wording exactly per the 7H.3 spec. Branches ONLY on payout.status (or
 * null) -- never on round status, and RECORDED is never described as
 * confirmed receipt.
 */
export function getPayoutPresentation(payout: MemberPayoutResult): BadgePresentation & { description: string } {
  if (!payout) {
    return { label: "Not yet recorded", description: "Not yet recorded.", className: NEUTRAL_BADGE_CLASS };
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

export function formatCircleDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDateOnly(value));
}

export function formatCircleDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
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
