import type { MemberPayoutsPayoutResult } from "@/src/services/payout-member-read.service";

// Pure, framework-free presentation logic for the recipient payout card
// (7K.10) -- no React, no service/repository access, nothing async. Same
// posture as payout-desk-display.ts (the owner-side sibling): this module
// only formats and derives display ELIGIBILITY from fields
// getCircleMemberPayouts already computed and serialized. It never
// recalculates a financial amount and never invents a financial state the
// read model didn't already decide (payout.status is read verbatim, never
// guessed from round.status or a due date).

export type BadgePresentation = { readonly label: string; readonly className: string };

const UNRECORDED_BADGE_CLASS = "bg-[#efe7db] text-[#587066]";
const RECORDED_BADGE_CLASS = "bg-[#fff0d9] text-[#8a5b27]";
const CONFIRMED_BADGE_CLASS = "bg-[#e6f0e8] text-[#35634f]";
const DISPUTED_BADGE_CLASS = "bg-[#f4e6e1] text-[#8d4f42]";

/**
 * Wording per the 7K.10 spec (sections 7-10): a null payout means the
 * owner has not recorded anything yet -- the member cannot decide on a
 * payout that doesn't exist as a persisted fact. RECORDED means the owner
 * recorded it and it now awaits the recipient's own decision. CONFIRMED
 * means the recipient already confirmed receiving it. DISPUTED means the
 * recipient already reported it was not validly received -- worded as a
 * plain historical fact, never as "pending adjudication," "awaiting
 * correction," or something NIA will resolve/refund, because it is
 * terminal in V1 (7K.1 sign-off item 2). Branches only on payout.status
 * (or its absence) -- never on round.status or a due date.
 */
export function getMemberPayoutStatusPresentation(
  status: MemberPayoutsPayoutResult["status"] | null,
): BadgePresentation & { description: string } {
  if (status === null) {
    return {
      label: "Not yet recorded",
      description: "No payout has been recorded yet. The circle owner records it once it happens outside NIA.",
      className: UNRECORDED_BADGE_CLASS,
    };
  }
  if (status === "RECORDED") {
    return {
      label: "Awaiting your decision",
      description: "The circle owner recorded this payout. Confirm receipt if you received it, or dispute it if you did not.",
      className: RECORDED_BADGE_CLASS,
    };
  }
  if (status === "CONFIRMED") {
    return {
      label: "Receipt confirmed",
      description: "You confirmed receiving this payout.",
      className: CONFIRMED_BADGE_CLASS,
    };
  }
  // DISPUTED
  return {
    label: "Receipt disputed",
    description: "You reported that this payout was not validly received.",
    className: DISPUTED_BADGE_CLASS,
  };
}

/**
 * Decision-control eligibility, derived from exactly one persisted fact
 * (7K.10 section 14): whether a Payout row exists AND is still RECORDED.
 * A null payout means nothing to decide on yet; CONFIRMED/DISPUTED are
 * both terminal -- no further decision is ever offered. round.status,
 * due dates, and obligation fulfillment are deliberately never consulted
 * here, mirroring the service's own frozen rule that payout mutation
 * eligibility is independent of round lifecycle (7K.1 sign-off item 3/
 * this ticket's own explicit instruction).
 */
export function canDecidePayout(payout: MemberPayoutsPayoutResult | null): boolean {
  return payout !== null && payout.status === "RECORDED";
}
