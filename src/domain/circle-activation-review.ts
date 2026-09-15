// Pure types and a pure fingerprint function -- no Prisma, no
// "server-only". Shared between circle-activation-review.service.ts
// (which computes a DraftCircleActivationReviewResult from live data) and
// the client-side review UI / activate-circle Server Action (which both
// need to compute the SAME fingerprint from a result they were each
// independently given, without importing server-only service code into a
// client bundle).

export type ActivationEligibilityBlocker = "INSUFFICIENT_MEMBERS" | "INCOMPLETE_PAYOUT_ORDER";

export type ActivationReviewMember = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly payoutOrder: number | null;
};

export type ActivationReviewRound = {
  readonly roundNumber: number;
  readonly recipientDisplayName: string;
  readonly recipientMemberCode: string;
  readonly dueDate: string;
  readonly expectedCollection: string;
};

export type DraftCircleActivationReviewCircle = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly status: "DRAFT";
  // Optional: existing pure-domain tests construct a circle literal without
  // these two fields, and computeActivationReviewFingerprint tolerates that
  // (see below) -- every real runtime caller (circle-draft-owner.service.ts,
  // circle.service.ts's assertFreshReviewMatches) always supplies both, so
  // the staleness guarantee below holds in practice for every live review.
  readonly originKind?: "NEW" | "IMPORTED";
  readonly historicalCompletedRoundCount?: number;
};

export type DraftCircleActivationReviewResult = {
  readonly circle: DraftCircleActivationReviewCircle;
  readonly activeMemberCount: number;
  readonly orderedActiveMembers: readonly ActivationReviewMember[];
  readonly eligible: boolean;
  readonly blockers: readonly ActivationEligibilityBlocker[];
  readonly proposedRounds: readonly ActivationReviewRound[];
  readonly expectedContributionPerMember: string;
  readonly expectedCollectionPerRound: string;
  readonly expectedTotalAcrossRotation: string;
};

/**
 * A deterministic fingerprint of the terms, active cohort, and payout order
 * shown in an activation review. DRAFT terms are now owner-editable, so they
 * must participate alongside membership/order: activation may never proceed
 * against terms different from the review the owner confirmed.
 *
 * Used by the review UI (to submit what it displayed) and by
 * activateCircleAction (to recompute the CURRENT fingerprint fresh at
 * submission time and compare) -- never persisted, never itself a source
 * of authority. See docs in circle-activation-review.service.ts /
 * activate-circle.ts for how this is used to require a fresh review
 * rather than silently activating a materially different configuration
 * than the one the owner actually confirmed.
 *
 * 9D.1 (docs/product/susu-existing-import-contract-freeze.md §11):
 * originKind and historicalCompletedRoundCount ("K") now participate
 * alongside the other terms -- a change to either between the owner's
 * review and activation must invalidate that review exactly like a
 * changed contributionAmount or startDate already does. Imported
 * activation itself remains blocked (circle.service.ts's activateCircle),
 * but the fingerprint must still reflect K/origin now so a future 9E does
 * not inherit a staleness gap.
 */
export function computeActivationReviewFingerprint(
  review: Pick<DraftCircleActivationReviewResult, "orderedActiveMembers"> & Partial<Pick<DraftCircleActivationReviewResult, "circle">>,
): string {
  const terms = review.circle
    ? [
        review.circle.name,
        review.circle.currency,
        review.circle.contributionAmount,
        review.circle.frequency,
        review.circle.startDate,
        review.circle.originKind ?? "",
        review.circle.historicalCompletedRoundCount ?? "",
      ].join("|")
    : "";
  return `${terms}::${review.orderedActiveMembers.map((member) => `${member.id}:${member.payoutOrder}`).join("|")}`;
}
