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
 * A deterministic fingerprint of exactly the two things that can go stale
 * between loading a review and submitting activation: the active cohort
 * and its payout order. Contribution terms (amount/currency/frequency/
 * startDate) are immutable from circle creation onward -- no service
 * exists anywhere in this codebase to edit them post-creation -- so they
 * are deliberately excluded from the fingerprint; only membership/order
 * can actually drift while a review is on screen.
 *
 * Used by the review UI (to submit what it displayed) and by
 * activateCircleAction (to recompute the CURRENT fingerprint fresh at
 * submission time and compare) -- never persisted, never itself a source
 * of authority. See docs in circle-activation-review.service.ts /
 * activate-circle.ts for how this is used to require a fresh review
 * rather than silently activating a materially different configuration
 * than the one the owner actually confirmed.
 */
export function computeActivationReviewFingerprint(
  review: Pick<DraftCircleActivationReviewResult, "orderedActiveMembers">,
): string {
  return review.orderedActiveMembers.map((member) => `${member.id}:${member.payoutOrder}`).join("|");
}
