import type {
  OwnerContributionsObligationResult,
  OwnerContributionsPaymentResult,
} from "@/src/services/contribution-owner-read.service";

// Pure, framework-free presentation logic for the owner contribution desk
// (7J.7) -- no React, no service/repository access, nothing async. This
// module only formats, groups, and derives ELIGIBILITY from fields
// getOwnerCircleContributions already computed and serialized; it never
// recalculates a financial amount (formatContributionMoney only groups/pads
// an already-fixed-decimal string, exactly like
// member-dashboard-display.ts's formatCircleMoney) and never infers a
// financial state the read model didn't already decide (obligation.status,
// payment.status are read verbatim, never guessed from a due date or round
// status). Money-formatting/date-formatting are kept as their own small
// copies here rather than cross-tree imports from the member-facing
// module, matching the existing convention (see circle-workspace-display.ts's
// own comment on getRoundStatusBadge) -- these are a different audience's
// presentation layer, even though the underlying formula is identical.

export type BadgePresentation = { readonly label: string; readonly className: string };

const CONFIRMED_BADGE_CLASS = "bg-[#e6f0e8] text-[#35634f]";
const PENDING_BADGE_CLASS = "bg-[#fff0d9] text-[#8a5b27]";
const NEUTRAL_BADGE_CLASS = "bg-[#efe7db] text-[#587066]";
const NEGATIVE_BADGE_CLASS = "bg-[#f4e6e1] text-[#8d4f42]";

/**
 * Labels an obligation's own persisted status verbatim (OPEN/FULFILLED) --
 * never infers fulfillment from confirmedAmount/outstandingAmount itself,
 * even though those are ledger-derived and available side by side. Both
 * facts are shown; this only labels the persisted one.
 */
export function getObligationStatusPresentation(status: string): BadgePresentation {
  if (status === "FULFILLED") return { label: "Fulfilled", className: CONFIRMED_BADGE_CLASS };
  if (status === "OPEN") return { label: "Open", className: PENDING_BADGE_CLASS };
  return { label: status, className: NEUTRAL_BADGE_CLASS };
}

/**
 * Wording per the 7J.7 spec (section 12): RECORDED means entered into NIA,
 * not yet confirmed received; CONFIRMED means the owner confirmed the
 * contribution happened outside NIA; REJECTED means that recorded attempt
 * was not accepted. Branches only on payment.status -- never on obligation
 * status or round status.
 */
export function getPaymentStatusPresentation(status: string): BadgePresentation & { description: string } {
  if (status === "RECORDED") {
    return {
      label: "Recorded",
      description: "Entered into NIA — not yet confirmed received.",
      className: PENDING_BADGE_CLASS,
    };
  }
  if (status === "CONFIRMED") {
    return {
      label: "Confirmed",
      description: "Confirmed as received outside NIA.",
      className: CONFIRMED_BADGE_CLASS,
    };
  }
  if (status === "REJECTED") {
    return {
      label: "Rejected",
      description: "Not accepted as a valid contribution.",
      className: NEGATIVE_BADGE_CLASS,
    };
  }
  return { label: status, description: "", className: NEUTRAL_BADGE_CLASS };
}

/**
 * Formats an already-fixed-decimal string (e.g. "1234.50", produced by the
 * read model's own Prisma.Decimal-derived toMoney) for display -- grouping
 * and padding only, never re-parsing into a number and recalculating.
 */
export function formatContributionMoney(value: string, currency: string): string {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;
  return `${currency} ${groupedWhole}${displayedFraction}`;
}

export function formatContributionDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(value),
  );
}

/**
 * Every obligation belonging to one round, keyed by roundId -- pure
 * regrouping of the read model's own flat obligations array; introduces no
 * new fact and drops nothing.
 */
export function groupObligationsByRoundId(
  obligations: readonly OwnerContributionsObligationResult[],
): Map<string, OwnerContributionsObligationResult[]> {
  const byRoundId = new Map<string, OwnerContributionsObligationResult[]>();
  for (const obligation of obligations) {
    const existing = byRoundId.get(obligation.roundId);
    if (existing) {
      existing.push(obligation);
    } else {
      byRoundId.set(obligation.roundId, [obligation]);
    }
  }
  return byRoundId;
}

/**
 * Every payment attempt belonging to one obligation, keyed by obligationId
 * -- pure regrouping of the read model's own flat payments array. Includes
 * REJECTED rows: this function never filters by status, so a rejected
 * attempt that predates a later successful payment is never dropped (7J.7
 * section 5).
 */
export function groupPaymentsByObligationId(
  payments: readonly OwnerContributionsPaymentResult[],
): Map<string, OwnerContributionsPaymentResult[]> {
  const byObligationId = new Map<string, OwnerContributionsPaymentResult[]>();
  for (const payment of payments) {
    const existing = byObligationId.get(payment.obligationId);
    if (existing) {
      existing.push(payment);
    } else {
      byObligationId.set(payment.obligationId, [payment]);
    }
  }
  return byObligationId;
}

/**
 * Newest attempt first, for display -- a pure re-sort of whatever set of
 * payments is passed in; drops nothing, hides nothing, and is stable
 * (falls back to id) for two attempts recorded in the same instant.
 */
export function sortPaymentsNewestFirst(
  payments: readonly OwnerContributionsPaymentResult[],
): OwnerContributionsPaymentResult[] {
  return [...payments].sort((a, b) => {
    const byRecordedAt = b.recordedAt.localeCompare(a.recordedAt);
    return byRecordedAt !== 0 ? byRecordedAt : b.id.localeCompare(a.id);
  });
}

/**
 * The one RECORDED payment currently unresolved for an obligation, if any.
 * The backend's own partial unique index guarantees at most one RECORDED-
 * or-CONFIRMED row can ever exist per obligation at a time, so at most one
 * match is expected here -- this reads that invariant defensively (returns
 * the first match) rather than assuming it, and never guesses which
 * attempt is "active" from anything but its own persisted status.
 */
export function findActiveRecordedPayment(
  payments: readonly OwnerContributionsPaymentResult[],
): OwnerContributionsPaymentResult | undefined {
  return payments.find((payment) => payment.status === "RECORDED");
}

/**
 * Eligibility for a FRESH recording, derived only from persisted facts
 * (7J.7 section 10) -- never a new financial rule invented in React:
 *
 * - FULFILLED obligation: no new-record form (the backend's own atomic
 *   confirm-and-fulfill write, and its partial unique index, both already
 *   forbid a further RECORDED/CONFIRMED row here regardless of what this
 *   function returns -- this only decides whether to bother rendering the
 *   form at all).
 * - OPEN + an active RECORDED attempt: no second record form -- the
 *   existing attempt must be confirmed or rejected first.
 * - OPEN + no active RECORDED/CONFIRMED attempt: a fresh recording is
 *   allowed.
 *
 * The CONFIRMED check is defensive, not merely redundant with `status`:
 * confirmContribution's own atomic write means a CONFIRMED payment and an
 * OPEN obligation should never coexist, but this function does not assume
 * that invariant holds and checks both facts independently rather than
 * trusting one to imply the other.
 */
export function canRecordFreshContribution(
  obligation: Pick<OwnerContributionsObligationResult, "status">,
  payments: readonly OwnerContributionsPaymentResult[],
): boolean {
  if (obligation.status !== "OPEN") return false;
  return !payments.some((payment) => payment.status === "RECORDED" || payment.status === "CONFIRMED");
}
