import "server-only";

import {
  findCircleForOwnerRead,
  findCircleMembersForOwner,
  type OwnerCircleMemberRecord,
} from "@/src/repositories/circle-draft-owner.repository";

// Read-only. This service accepts only a trusted { ownerId, circleId }
// pair -- it never reads cookies, never calls requireUser(), and never
// imports next/headers or next/navigation. Authorization derivation is the
// caller's job (requireUser(), at the route/page boundary, exactly as
// circle.actions.ts already does for the create-circle action); this file
// independently re-verifies ownership and circle state below rather than
// trusting the caller blindly, but it is never itself a public
// authentication boundary.

export class DraftCircleOwnerReadNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "DraftCircleOwnerReadNotFoundError";
  }
}

export class DraftCircleOwnerReadAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to view this circle.");
    this.name = "DraftCircleOwnerReadAuthorizationError";
  }
}

export class DraftCircleOwnerReadNotDraftError extends Error {
  constructor() {
    super("This read is only available for draft circles.");
    this.name = "DraftCircleOwnerReadNotDraftError";
  }
}

export type DraftCircleOwnerCircleResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly status: "DRAFT";
};

export type DraftCircleOwnerMemberResult = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly email: string | null;
  readonly status: "ACTIVE" | "REMOVED";
  readonly payoutOrder: number | null;
  readonly addedAt: string;
  readonly removedAt: string | null;
};

export type DraftCircleOwnerResult = {
  readonly circle: DraftCircleOwnerCircleResult;
  readonly members: readonly DraftCircleOwnerMemberResult[];
};

/**
 * Deterministic member ordering: ACTIVE members first (by payoutOrder
 * ascending, nulls last, then addedAt ascending, then id as a final
 * tiebreak), followed by REMOVED members (by removedAt ascending, then id).
 * This is applied in application code -- not a database ORDER BY -- because
 * the two groups need different sort keys, which a single flat Prisma
 * orderBy can't express, and because relying on CircleMemberStatus's own
 * string ordering ("ACTIVE" < "REMOVED") to put active members first would
 * be an implicit, fragile coincidence rather than a stated rule.
 */
function compareOwnerMembers(left: OwnerCircleMemberRecord, right: OwnerCircleMemberRecord): number {
  if (left.status !== right.status) {
    return left.status === "ACTIVE" ? -1 : 1;
  }

  if (left.status === "ACTIVE") {
    const leftOrder = left.payoutOrder ?? Number.POSITIVE_INFINITY;
    const rightOrder = right.payoutOrder ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const addedAtDiff = left.addedAt.getTime() - right.addedAt.getTime();
    if (addedAtDiff !== 0) return addedAtDiff;

    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  }

  const leftRemovedAt = left.removedAt?.getTime() ?? 0;
  const rightRemovedAt = right.removedAt?.getTime() ?? 0;
  if (leftRemovedAt !== rightRemovedAt) return leftRemovedAt - rightRemovedAt;

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function serializeMember(member: OwnerCircleMemberRecord): DraftCircleOwnerMemberResult {
  return {
    id: member.id,
    displayName: member.displayName,
    memberCode: member.memberCode,
    email: member.email,
    status: member.status,
    payoutOrder: member.payoutOrder,
    addedAt: member.addedAt.toISOString(),
    removedAt: member.removedAt?.toISOString() ?? null,
  };
}

/**
 * Reads exactly one DRAFT circle and its full member history (ACTIVE and
 * REMOVED) for the platform User who owns it. Rejects, with a specific
 * internal error, if the circle doesn't exist, belongs to a different
 * owner, or is no longer DRAFT (ACTIVE/COMPLETED/ARCHIVED circles are not
 * reachable through this DRAFT-specific read at all). These errors are
 * specific and internal -- like circle.service.ts's own
 * DraftCircleMembershipAuthorizationError/DraftCircleMembershipConflictError
 * -- because this is called from an already-authenticated server context,
 * not a public boundary; the future page is responsible for mapping
 * "not found" and "not authorized" to the same safe outward behavior so
 * neither reveals whether some other owner's circle exists.
 */
export async function getDraftCircleForOwner(input: {
  ownerId: string;
  circleId: string;
}): Promise<DraftCircleOwnerResult> {
  const circle = await findCircleForOwnerRead(input.circleId);
  if (!circle) throw new DraftCircleOwnerReadNotFoundError();
  if (circle.ownerId !== input.ownerId) throw new DraftCircleOwnerReadAuthorizationError();
  if (circle.status !== "DRAFT") throw new DraftCircleOwnerReadNotDraftError();

  const members = await findCircleMembersForOwner(input.circleId);
  const orderedMembers = [...members].sort(compareOwnerMembers);

  return {
    circle: {
      id: circle.id,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      startDate: circle.startDate.toISOString().slice(0, 10),
      status: "DRAFT",
    },
    members: orderedMembers.map(serializeMember),
  };
}
