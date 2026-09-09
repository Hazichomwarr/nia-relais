import { computeActivationReviewFingerprint } from "@/src/domain/circle-activation-review";
import {
  DraftCircleOwnerReadAuthorizationError,
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
  getDraftCircleActivationReview,
} from "@/src/services/circle-activation-review.service";
import {
  activateCircle,
  CircleActivationEligibilityError,
  CircleActivationIntegrityError,
  CircleActivationStaleReviewError,
  DraftCircleMemberNotFoundError,
  DraftCircleMembershipAuthorizationError,
} from "@/src/services/circle.service";

// Testable core, deliberately not a "use server" file -- same split as
// every other owner action in this ticket sequence.
//
// The client submits only circleId, an explicit confirmation, and the
// fingerprint of the review it was shown -- never terms, member ids,
// payout order, totals, rounds, obligations, status, or provenance.
// activateCircle itself takes no such data either (only
// { ownerId, circleId, expectedFingerprint }), so there is structurally
// nothing for a forged field to influence even if one were submitted.
//
// Staleness handling (7I.5 section 9, hardened by 7I.5.1): activateCircle
// is always the final authority -- it re-reads and re-validates fresh
// state under its own row lock regardless of anything this action does
// first, so a stale review can NEVER cause the wrong cohort/order to be
// persisted. There are now TWO staleness checks, deliberately at
// different layers:
//
//   1. This action's own preflight (below): re-fetches the review fresh
//      at submission time and compares fingerprints BEFORE ever calling
//      activateCircle -- fast, friendly, but inherently racy (a change
//      could still land between this check and the lock).
//   2. activateCircle's own atomic guard (circle.service.ts,
//      assertFreshReviewMatches): re-checks the SAME fingerprint again,
//      but inside the transaction, after the row lock is held and members
//      are read fresh under that lock -- this is the actual authoritative
//      guard, race-free by construction. See the 7I.5.1 audit for the
//      precise race this closes.
//
// Both checks compare against the SAME fingerprint the client submitted
// (`submittedFingerprint`, passed through unchanged as expectedFingerprint
// to activateCircle) -- this action never computes a second, different
// fingerprint of its own.

export type TrustedOwner = { readonly id: string; readonly name: string };

export type ActivateCircleDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly getDraftCircleActivationReview: typeof getDraftCircleActivationReview;
  readonly activateCircle: typeof activateCircle;
};

async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: ActivateCircleDependencies = {
  requireUser: requireRealUser,
  getDraftCircleActivationReview,
  activateCircle,
};

export type ActivateCircleActionState = {
  readonly formError?: string;
};

export type ActivateCircleOutcome =
  | { readonly ok: true; readonly circleId: string }
  | { readonly ok: false; readonly state: ActivateCircleActionState };

const CONFIRMATION_MESSAGE =
  "Please confirm you have reviewed the members, payout order, and contribution terms before activating.";
const STALE_REVIEW_MESSAGE =
  "This circle's members or payout order changed since you last reviewed it. Please review the current configuration and try again.";
const NOT_ELIGIBLE_MESSAGE = "This circle is not yet eligible for activation.";
const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";

export async function runActivateCircleAction(
  formData: FormData,
  dependencies: Partial<ActivateCircleDependencies> = {},
): Promise<ActivateCircleOutcome> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const confirmed = formData.get("confirmed") === "true";
  const submittedFingerprint = String(formData.get("reviewFingerprint") ?? "");

  if (circleId.length === 0) {
    return { ok: false, state: { formError: GENERIC_NOT_FOUND_MESSAGE } };
  }
  if (!confirmed) {
    return { ok: false, state: { formError: CONFIRMATION_MESSAGE } };
  }

  let currentReview;
  try {
    currentReview = await deps.getDraftCircleActivationReview({ ownerId: user.id, circleId });
  } catch (error) {
    if (error instanceof DraftCircleOwnerReadNotFoundError || error instanceof DraftCircleOwnerReadAuthorizationError) {
      return { ok: false, state: { formError: GENERIC_NOT_FOUND_MESSAGE } };
    }
    if (error instanceof DraftCircleOwnerReadNotDraftError) {
      return { ok: false, state: { formError: "This circle is no longer a draft." } };
    }
    throw error;
  }

  if (computeActivationReviewFingerprint(currentReview) !== submittedFingerprint) {
    return { ok: false, state: { formError: STALE_REVIEW_MESSAGE } };
  }
  if (!currentReview.eligible) {
    return { ok: false, state: { formError: NOT_ELIGIBLE_MESSAGE } };
  }

  try {
    const result = await deps.activateCircle({
      ownerId: user.id,
      circleId,
      expectedFingerprint: submittedFingerprint,
    });
    return { ok: true, circleId: result.circle.id };
  } catch (error) {
    if (error instanceof DraftCircleMemberNotFoundError || error instanceof DraftCircleMembershipAuthorizationError) {
      return { ok: false, state: { formError: GENERIC_NOT_FOUND_MESSAGE } };
    }
    if (error instanceof CircleActivationEligibilityError) {
      return { ok: false, state: { formError: error.message } };
    }
    // The atomic guard inside activateCircle itself caught a race the
    // preflight check above missed (membership/order changed in the
    // window between that check and the row lock) -- same safe message,
    // since from the owner's perspective both mean the same thing.
    if (error instanceof CircleActivationStaleReviewError) {
      return { ok: false, state: { formError: STALE_REVIEW_MESSAGE } };
    }
    if (error instanceof CircleActivationIntegrityError) {
      return { ok: false, state: { formError: "This circle's rotation could not be verified. Please refresh and try again." } };
    }

    console.error(
      "[activateCircleAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { ok: false, state: { formError: "We could not activate this circle. Please try again." } };
  }
}
