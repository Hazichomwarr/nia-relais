import {
  DraftCircleMemberNotFoundError,
  DraftCircleMembershipAuthorizationError,
  DraftCircleMembershipConflictError,
  removeDraftCircleMember,
} from "@/src/services/circle.service";

export type TrustedOwner = { readonly id: string; readonly name: string };

export type RemoveDraftCircleMemberDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly removeDraftCircleMember: typeof removeDraftCircleMember;
};

async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: RemoveDraftCircleMemberDependencies = {
  requireUser: requireRealUser,
  removeDraftCircleMember,
};

export type RemoveDraftCircleMemberOutcome = { readonly ok: boolean; readonly circleId: string };

/**
 * Removes one member from a DRAFT circle the caller owns. requireUser()
 * runs first; ownerId comes exclusively from it. circleId/memberId are
 * read from the form as plain, non-secret ids -- the service itself
 * independently re-verifies ownership, membership, and draft status, so a
 * forged/stale value (e.g. resubmitted after activation, or pointed at
 * someone else's circle) is rejected there, not trusted here.
 *
 * Every expected failure -- not found, wrong owner, or the circle no
 * longer being DRAFT (including a stale form resubmitted after
 * activation) -- collapses to the same outcome ({ ok: false }) here.
 * There is no useActionState/field-error channel on this action (its real
 * "use server" wrapper takes a single FormData argument, matching a plain
 * progressive-enhancement form binding like the existing logoutAction),
 * so this deliberately does not attempt to distinguish failure reasons to
 * the caller -- the page's next natural read (via revalidation or a
 * reload) already reflects true current state regardless of why removal
 * did not happen.
 */
export async function runRemoveDraftCircleMemberAction(
  formData: FormData,
  dependencies: Partial<RemoveDraftCircleMemberDependencies> = {},
): Promise<RemoveDraftCircleMemberOutcome> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const memberId = String(formData.get("memberId") ?? "").trim();
  if (circleId.length === 0 || memberId.length === 0) {
    return { ok: false, circleId };
  }

  try {
    await deps.removeDraftCircleMember({ ownerId: user.id, circleId, memberId });
    return { ok: true, circleId };
  } catch (error) {
    if (
      error instanceof DraftCircleMemberNotFoundError
      || error instanceof DraftCircleMembershipAuthorizationError
      || error instanceof DraftCircleMembershipConflictError
    ) {
      return { ok: false, circleId };
    }

    console.error(
      "[removeDraftCircleMemberAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { ok: false, circleId };
  }
}
