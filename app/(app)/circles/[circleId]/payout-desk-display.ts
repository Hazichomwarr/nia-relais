import type { OwnerPayoutsPayoutResult } from "@/src/services/payout-owner-read.service";

// Pure, framework-free presentation logic for the owner payout desk
// (7K.9) -- no React, no service/repository access, nothing async. Same
// posture as contribution-desk-display.ts: this module only formats and
// derives display ELIGIBILITY from fields getOwnerCirclePayouts already
// computed and serialized. It never recalculates a financial amount and
// never invents a financial state the read model didn't already decide
// (payout.status is read verbatim, never guessed from round.status or a
// due date). Money/date formatting is reused directly from
// contribution-desk-display.ts rather than copied a third time -- both
// are the SAME audience (the owner, same route directory), unlike the
// owner-vs-member split that justifies separate copies elsewhere in this
// codebase (see circle-workspace-display.ts's own comment).

export type BadgePresentation = { readonly label: string; readonly className: string };

const UNRECORDED_BADGE_CLASS = "bg-[#efe7db] text-[#587066]";
const RECORDED_BADGE_CLASS = "bg-[#fff0d9] text-[#8a5b27]";
const CONFIRMED_BADGE_CLASS = "bg-[#e6f0e8] text-[#35634f]";
const DISPUTED_BADGE_CLASS = "bg-[#f4e6e1] text-[#8d4f42]";

/**
 * Wording per the 7K.9 spec (section 5): UNRECORDED means no external
 * payout has been entered into NIA yet; RECORDED means the owner entered
 * it and it awaits the recipient's own decision; CONFIRMED means the
 * recipient confirmed receiving it; DISPUTED means the recipient reported
 * it was not validly received -- and DISPUTED is never worded as
 * "awaiting correction," "retry available," or otherwise fixable, because
 * it is a terminal state in V1 (7K.1 sign-off item 2). Branches only on
 * payout.status (or its absence) -- never on round.status or a due date.
 */
export function getPayoutStatusPresentation(
  status: OwnerPayoutsPayoutResult["status"] | null,
): BadgePresentation & { description: string } {
  if (status === null) {
    return {
      label: "Unrecorded",
      description: "No payout has been recorded yet.",
      className: UNRECORDED_BADGE_CLASS,
    };
  }
  if (status === "RECORDED") {
    return {
      label: "Recorded",
      description: "The payout was recorded and is waiting for the recipient's decision.",
      className: RECORDED_BADGE_CLASS,
    };
  }
  if (status === "CONFIRMED") {
    return {
      label: "Confirmed",
      description: "The recipient confirmed receiving this payout.",
      className: CONFIRMED_BADGE_CLASS,
    };
  }
  // DISPUTED
  return {
    label: "Disputed",
    description: "The recipient reported that this payout was not validly received.",
    className: DISPUTED_BADGE_CLASS,
  };
}

/**
 * Eligibility for a fresh recording, derived from exactly one persisted
 * fact (7K.9 section 4): whether a Payout row exists for this round at
 * all. A `payout` of `null` means unrecorded -- the record control is
 * shown. Any existing payout row, regardless of its own status
 * (RECORDED/CONFIRMED/DISPUTED) or the round's own status
 * (UPCOMING/ACTIVE/CLOSED), means no fresh record control is ever shown
 * here -- Payout's full @@unique([roundId]) already makes a second
 * recording impossible at the database level (7K audit section 6); this
 * only decides whether to bother rendering the form at all. round.status
 * is deliberately never read by this function.
 */
export function canRecordFreshPayout(payout: OwnerPayoutsPayoutResult | null): boolean {
  return payout === null;
}
