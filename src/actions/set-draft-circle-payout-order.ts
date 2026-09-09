import {
  DraftCircleMemberNotFoundError,
  DraftCircleMembershipAuthorizationError,
  DraftCircleMembershipConflictError,
  DraftCirclePayoutOrderError,
  InvalidDraftCircleError,
  setDraftCirclePayoutOrder,
} from "@/src/services/circle.service";

// Testable core, deliberately not a "use server" file -- same split as
// create-draft-circle.ts / add-draft-circle-member.ts.
//
// Ordering validation is NOT duplicated here: setDraftCirclePayoutOrder
// itself re-validates the submitted array (via setDraftCirclePayoutOrderSchema
// -- min length 1, no duplicates, throwing InvalidDraftCircleError on any
// shape failure) AND re-verifies it represents exactly the current ACTIVE
// cohort against fresh database state (throwing DraftCirclePayoutOrderError
// on any mismatch -- wrong size, duplicate, missing, or a REMOVED/foreign
// member id). This module only extracts the submitted sequence from
// FormData and maps whatever the service decides to a safe result --
// it makes no independent judgment about what a valid order looks like.

export type SetDraftCirclePayoutOrderMember = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly payoutOrder: number;
};

export type SetDraftCirclePayoutOrderActionState = {
  readonly status?: "success";
  readonly formError?: string;
  readonly members?: readonly SetDraftCirclePayoutOrderMember[];
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type SetDraftCirclePayoutOrderDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly setDraftCirclePayoutOrder: typeof setDraftCirclePayoutOrder;
};

async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: SetDraftCirclePayoutOrderDependencies = {
  requireUser: requireRealUser,
  setDraftCirclePayoutOrder,
};

/**
 * Saves a full payout-order sequence for a DRAFT circle's ACTIVE cohort.
 * requireUser() runs first; ownerId comes exclusively from it. The client
 * submits only the ordered sequence of member ids (repeated "memberId"
 * form entries, in display order) -- never a memberId -> payoutOrder map,
 * never a numeric payoutOrder value, never ownerId/status/provenance. The
 * service remains the sole authority for assigning 1...N and for deciding
 * whether the submitted sequence is even a valid permutation of the
 * circle's current ACTIVE members.
 */
export async function runSetDraftCirclePayoutOrderAction(
  formData: FormData,
  dependencies: Partial<SetDraftCirclePayoutOrderDependencies> = {},
): Promise<SetDraftCirclePayoutOrderActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const orderedMemberIds = formData.getAll("memberId").map((value) => String(value));

  if (circleId.length === 0) {
    return { formError: "We could not find this circle." };
  }

  try {
    const members = await deps.setDraftCirclePayoutOrder({ ownerId: user.id, circleId, orderedMemberIds });
    return {
      status: "success",
      members: members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        memberCode: member.memberCode,
        payoutOrder: member.payoutOrder,
      })),
    };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    // Conflict (not DRAFT) is safe to state plainly: assertDraftOwner
    // (circle.service.ts) checks ownership BEFORE draft status, so this
    // error is only ever reachable for a circle the caller genuinely owns.
    if (error instanceof DraftCircleMemberNotFoundError || error instanceof DraftCircleMembershipAuthorizationError) {
      return { formError: "We could not find this circle." };
    }
    if (error instanceof DraftCircleMembershipConflictError) {
      return { formError: "Payout order can only be changed while the circle is still a draft." };
    }
    if (error instanceof DraftCirclePayoutOrderError) {
      return { formError: "This order no longer matches the circle's current members. Please review and try again." };
    }
    if (error instanceof InvalidDraftCircleError) {
      return { formError: error.message };
    }

    console.error(
      "[setDraftCirclePayoutOrderAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not save the payout order. Please try again." };
  }
}
