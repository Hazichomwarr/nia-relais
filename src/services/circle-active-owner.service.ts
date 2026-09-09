import "server-only";

import { selectCurrentAndNextRound } from "@/src/domain/circle-round-selection";
import {
  findActiveCircleForOwnerRead,
  findActiveCircleMembersForOwner,
  findRoundsForOwner,
} from "@/src/repositories/circle-active-owner.repository";

// Read-only, owner-scoped ACTIVE circle summary. Originally minimal (7I.5:
// just enough for a valid post-activation destination); extended (7I.6)
// with the frozen terms, the ordered member list, the full persisted
// rotation, and the current/next round position -- no financial
// (payment/payout) totals, per this ticket's explicit exclusion.
//
// Historical authority (7I.6, section 1/3): every rotation fact rendered
// here comes from the persisted PayoutRound row itself -- recipientId
// (never re-derived from "whichever member currently has payoutOrder=N"),
// dueDate (frozen at activation, never recomputed from today's date), and
// status (read verbatim; never inferred as ACTIVE merely because a due
// date has passed). This mirrors exactly what the 7I audit named as what
// activation must preserve: the frozen cohort, ordered recipients,
// original terms, due dates, and activation actor/time -- this service
// only reads that, it never reconstructs it.

export class ActiveCircleOwnerReadNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "ActiveCircleOwnerReadNotFoundError";
  }
}

export class ActiveCircleOwnerReadAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to view this circle.");
    this.name = "ActiveCircleOwnerReadAuthorizationError";
  }
}

export class ActiveCircleOwnerReadNotActiveError extends Error {
  constructor() {
    super("This read is only available for active circles.");
    this.name = "ActiveCircleOwnerReadNotActiveError";
  }
}

export type ActiveCircleOwnerCircleResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly status: "ACTIVE";
  readonly activatedAt: string;
};

export type ActiveCircleOwnerMemberResult = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly payoutOrder: number;
};

export type ActiveCircleOwnerRoundResult = {
  readonly id: string;
  readonly roundNumber: number;
  readonly recipientDisplayName: string;
  readonly recipientMemberCode: string;
  readonly dueDate: string;
  readonly status: string;
};

export type ActiveCircleOwnerSummaryResult = {
  readonly circle: ActiveCircleOwnerCircleResult;
  readonly members: readonly ActiveCircleOwnerMemberResult[];
  readonly rounds: readonly ActiveCircleOwnerRoundResult[];
  readonly currentRound: ActiveCircleOwnerRoundResult | null;
  readonly nextRound: ActiveCircleOwnerRoundResult | null;
  readonly totalRoundCount: number;
  readonly closedRoundCount: number;
};

function serializeRound(round: {
  id: string;
  roundNumber: number;
  dueDate: Date;
  status: string;
  recipient: { displayName: string; memberCode: string };
}): ActiveCircleOwnerRoundResult {
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    recipientDisplayName: round.recipient.displayName,
    recipientMemberCode: round.recipient.memberCode,
    dueDate: round.dueDate.toISOString(),
    status: round.status,
  };
}

/**
 * Reads the full owner-facing summary of one ACTIVE circle: frozen terms,
 * ordered members, the persisted rotation, and the current/next round
 * position (via the same selectCurrentAndNextRound rule the member
 * dashboard uses -- see src/domain/circle-round-selection.ts). Rejects,
 * with a specific internal error, if the circle doesn't exist, belongs to
 * a different owner, or is not ACTIVE -- a DRAFT circle is rejected here
 * exactly as an ACTIVE circle is rejected by getDraftCircleForOwner, and
 * (until a future ticket extends this read) so are COMPLETED/ARCHIVED
 * circles, which must never be misrepresented as ACTIVE by this function.
 */
export async function getActiveCircleSummaryForOwner(input: {
  ownerId: string;
  circleId: string;
}): Promise<ActiveCircleOwnerSummaryResult> {
  const circle = await findActiveCircleForOwnerRead(input.circleId);
  if (!circle) throw new ActiveCircleOwnerReadNotFoundError();
  if (circle.ownerId !== input.ownerId) throw new ActiveCircleOwnerReadAuthorizationError();
  if (circle.status !== "ACTIVE" || !circle.activatedAt) throw new ActiveCircleOwnerReadNotActiveError();

  const [members, rounds] = await Promise.all([
    findActiveCircleMembersForOwner(input.circleId),
    findRoundsForOwner(input.circleId),
  ]);

  const serializedRounds = rounds.map(serializeRound);
  const { currentRound, nextRound } = selectCurrentAndNextRound(circle.status, rounds);

  return {
    circle: {
      id: circle.id,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      startDate: circle.startDate.toISOString().slice(0, 10),
      status: "ACTIVE",
      activatedAt: circle.activatedAt.toISOString(),
    },
    members: members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      memberCode: member.memberCode,
      // Every ACTIVE member has a non-null payoutOrder once activated
      // (frozen at activation; nothing can clear it afterward) -- the
      // fallback is only for TypeScript's benefit against the field's
      // nullable schema type, never expected to actually apply here.
      payoutOrder: member.payoutOrder ?? 0,
    })),
    rounds: serializedRounds,
    currentRound: currentRound ? serializeRound(currentRound) : null,
    nextRound: nextRound ? serializeRound(nextRound) : null,
    totalRoundCount: rounds.length,
    closedRoundCount: rounds.filter((round) => round.status === "CLOSED").length,
  };
}
