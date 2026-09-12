import "server-only";

import { findActiveCircleMembersForOwner } from "@/src/repositories/circle-active-owner.repository";
import { findCircleForCompletedOwnerRead } from "@/src/repositories/circle-completed-owner.repository";

// Read-only, owner-scoped SUSU historical summary for a COMPLETED circle
// (7L.3, fixing the P1 named by docs/product/susu-circle-completion-audit
// .md §14/§21/§27: the owner's own route used to 404 once a circle became
// COMPLETED, because getActiveCircleSummaryForOwner is deliberately
// ACTIVE-only and its own semantics ("this circle is active... can no
// longer be changed") would be dishonest to reuse for a circle that is no
// longer active at all).
//
// A dedicated read, not an extension of getActiveCircleSummaryForOwner
// (circle-active-owner.service.ts) -- per this ticket's own explicit
// framing, reusing an ACTIVE-only summary whose semantics imply ongoing
// operation would misrepresent a genuinely terminal state. This is the
// smallest new surface that remains truthful: circle identity/terms,
// status COMPLETED, completedAt, and the same ordered member list/count
// getActiveCircleSummaryForOwner already shows -- no round schedule (the
// existing payout desk, already COMPLETED-eligible, already shows the full
// persisted rotation with recipient/status/payout detail; duplicating it
// here would be a second, independently-drifting round read). No actor id
// (completedById, activatedById) is ever exposed -- the owner viewing
// their own circle needs to know THAT it completed and WHEN, not the
// internal identity that resolves to themselves anyway (7L.1 section 9:
// completedById can only ever equal the circle's own ownerId).

export class CompletedCircleOwnerReadNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "CompletedCircleOwnerReadNotFoundError";
  }
}

export class CompletedCircleOwnerReadAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to view this circle.");
    this.name = "CompletedCircleOwnerReadAuthorizationError";
  }
}

export class CompletedCircleOwnerReadNotCompletedError extends Error {
  constructor() {
    super("This read is only available for a completed circle.");
    this.name = "CompletedCircleOwnerReadNotCompletedError";
  }
}

export type CompletedCircleOwnerCircleResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly status: "COMPLETED";
  readonly completedAt: string;
};

export type CompletedCircleOwnerMemberResult = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly payoutOrder: number;
};

export type CompletedCircleOwnerSummaryResult = {
  readonly circle: CompletedCircleOwnerCircleResult;
  readonly members: readonly CompletedCircleOwnerMemberResult[];
  readonly memberCount: number;
};

/**
 * Reads the owner-facing historical summary of one COMPLETED circle:
 * frozen terms, status, completedAt, and the ordered member list -- every
 * fact read straight from persisted rows, never recomputed. Rejects, with
 * a specific internal error, if the circle doesn't exist, belongs to a
 * different owner, or is not COMPLETED -- an ACTIVE/DRAFT/CANCELLED/
 * ARCHIVED circle is rejected here exactly as a non-ACTIVE circle is
 * rejected by getActiveCircleSummaryForOwner, and must never be
 * misrepresented as COMPLETED by this function.
 */
export async function getCompletedCircleSummaryForOwner(input: {
  ownerId: string;
  circleId: string;
}): Promise<CompletedCircleOwnerSummaryResult> {
  const circle = await findCircleForCompletedOwnerRead(input.circleId);
  if (!circle) throw new CompletedCircleOwnerReadNotFoundError();
  if (circle.ownerId !== input.ownerId) throw new CompletedCircleOwnerReadAuthorizationError();
  if (circle.status !== "COMPLETED" || !circle.completedAt) throw new CompletedCircleOwnerReadNotCompletedError();

  const members = await findActiveCircleMembersForOwner(input.circleId);

  return {
    circle: {
      id: circle.id,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      startDate: circle.startDate.toISOString().slice(0, 10),
      status: "COMPLETED",
      completedAt: circle.completedAt.toISOString(),
    },
    members: members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      memberCode: member.memberCode,
      // Every member who was ever ACTIVE at completion time has a
      // permanent, non-null payoutOrder frozen at activation (identical
      // fallback rationale to getActiveCircleSummaryForOwner's own).
      payoutOrder: member.payoutOrder ?? 0,
    })),
    memberCount: members.length,
  };
}
