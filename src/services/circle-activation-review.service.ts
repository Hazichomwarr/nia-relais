import "server-only";

import { Prisma } from "@prisma/client";
import type { ContributionFrequency } from "@prisma/client";

import type {
  ActivationEligibilityBlocker,
  ActivationReviewMember,
  ActivationReviewRound,
  DraftCircleActivationReviewResult,
} from "@/src/domain/circle-activation-review";
import { roundDueDate } from "@/src/domain/circle-rotation-schedule";
import {
  DraftCircleOwnerReadAuthorizationError,
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
  getDraftCircleForOwner,
} from "@/src/services/circle-draft-owner.service";

export {
  DraftCircleOwnerReadAuthorizationError,
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
};
export type {
  ActivationEligibilityBlocker,
  ActivationReviewMember,
  ActivationReviewRound,
  DraftCircleActivationReviewResult,
};

// Read-only proposal. This never creates PayoutRound or
// ContributionObligation rows -- it only computes what activateCircle
// WOULD persist, using the exact same shared roundDueDate helper
// activateCircle itself uses (src/domain/circle-rotation-schedule.ts), so
// the proposed schedule can never silently diverge from what activation
// actually generates. Authorization is delegated entirely to
// getDraftCircleForOwner (circle-draft-owner.service.ts, 7I.2.1), which
// independently re-verifies ownership and DRAFT status against fresh
// database state on every call -- this function adds no separate
// authorization check, and re-exports that function's error classes
// directly rather than wrapping them, since the failure modes are
// identical.
//
// Eligibility computed here (member count, payout-order completeness) is
// explanatory only, for the UI to show blockers -- it is NEVER the
// authority for whether activation is allowed. activateCircle
// independently re-reads and re-validates fresh state under its own row
// lock every time it is called, regardless of what this function
// computed a moment earlier.

function parseUtcDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

const MINIMUM_ACTIVE_MEMBERS = 2;

function computeBlockers(activeMemberCount: number, hasCompletePayoutOrder: boolean): ActivationEligibilityBlocker[] {
  const blockers: ActivationEligibilityBlocker[] = [];
  if (activeMemberCount < MINIMUM_ACTIVE_MEMBERS) blockers.push("INSUFFICIENT_MEMBERS");
  if (!hasCompletePayoutOrder) blockers.push("INCOMPLETE_PAYOUT_ORDER");
  return blockers;
}

function hasCompleteSequentialPayoutOrder(activeMembers: readonly { payoutOrder: number | null }[]): boolean {
  if (activeMembers.length === 0) return false;
  const orders = activeMembers.map((member) => member.payoutOrder);
  if (orders.some((order) => order === null)) return false;

  const sorted = [...(orders as number[])].sort((left, right) => left - right);
  return sorted.every((order, index) => order === index + 1);
}

/**
 * Builds a read-only activation preview for a DRAFT circle: its terms, the
 * ordered active cohort, whether it is currently eligible to activate, any
 * safe explanatory blockers, and (only when eligible) the exact proposed
 * round schedule and Decimal-exact expected totals activation would
 * produce right now. Never authoritative -- see the module comment above.
 */
export async function getDraftCircleActivationReview(input: {
  ownerId: string;
  circleId: string;
}): Promise<DraftCircleActivationReviewResult> {
  const { circle, members } = await getDraftCircleForOwner(input);

  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const orderedActiveMembers: ActivationReviewMember[] = activeMembers.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    memberCode: member.memberCode,
    payoutOrder: member.payoutOrder,
  }));

  const hasCompletePayoutOrder = hasCompleteSequentialPayoutOrder(activeMembers);
  const blockers = computeBlockers(activeMembers.length, hasCompletePayoutOrder);
  const eligible = blockers.length === 0;

  const contributionAmount = new Prisma.Decimal(circle.contributionAmount);
  const expectedCollectionPerRound = eligible
    ? contributionAmount.times(activeMembers.length)
    : new Prisma.Decimal(0);
  const expectedTotalAcrossRotation = eligible
    ? expectedCollectionPerRound.times(activeMembers.length)
    : new Prisma.Decimal(0);

  const proposedRounds: ActivationReviewRound[] = eligible
    ? [...activeMembers]
        .sort((left, right) => (left.payoutOrder as number) - (right.payoutOrder as number))
        .map((member) => {
          const roundNumber = member.payoutOrder as number;
          const dueDate = roundDueDate(
            { frequency: circle.frequency as ContributionFrequency, startDate: parseUtcDateOnly(circle.startDate) },
            roundNumber,
          );
          return {
            roundNumber,
            recipientDisplayName: member.displayName,
            recipientMemberCode: member.memberCode,
            dueDate: dueDate.toISOString(),
            expectedCollection: toMoney(expectedCollectionPerRound),
          };
        })
    : [];

  return {
    circle,
    activeMemberCount: activeMembers.length,
    orderedActiveMembers,
    eligible,
    blockers,
    proposedRounds,
    expectedContributionPerMember: toMoney(contributionAmount),
    expectedCollectionPerRound: toMoney(expectedCollectionPerRound),
    expectedTotalAcrossRotation: toMoney(expectedTotalAcrossRotation),
  };
}
