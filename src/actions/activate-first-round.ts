import {
  PayoutAccountingIntegrityError,
  RoundLifecycleAuthorizationError,
  RoundLifecycleCircleNotActiveError,
  RoundLifecycleCircleNotFoundError,
  RoundLifecycleIntegrityError,
  activateFirstRound,
  type LifecycleRoundResult,
} from "@/src/services/round-lifecycle.service";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why. Owner-facing
// counterpart to record-payout.ts/activate-circle.ts's own authentication
// shape (requireUser, never requireCircleMember -- this is an owner-only
// lifecycle operation on the circle's own round schedule, not a member-
// facing payout action).
//
// Orchestration boundary only: every rule (ownership, the "circle must
// already be ACTIVE" precondition, the fresh-vs-replay resolution, the
// UPCOMING -> ACTIVE compare-and-swap) lives entirely inside
// activateFirstRound (round-lifecycle.service.ts, 7K.13) and is never
// reimplemented here. This action computes nothing about round state --
// no status, no activatedAt, no activatedById is ever read from the form
// -- circleId is the ONLY field this action accepts.
//
// A legitimate replay (round 1 already ACTIVE or CLOSED, reported back by
// the service with replayed: true) is surfaced as an ordinary success,
// never converted into an error -- the caller's original intent ("start
// round 1") was genuinely already satisfied.

export type ActivateFirstRoundActionState = {
  readonly status?: "success";
  readonly formError?: string;
  // Truthful, service-derived feedback copy -- never a UI string baked in
  // here independent of what the service actually reports. Always
  // "Round <n> is active." where <n> is the round's own true roundNumber
  // (always 1 for this operation, but derived rather than hardcoded).
  readonly message?: string;
  readonly round?: LifecycleRoundResult;
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type ActivateFirstRoundDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly activateFirstRound: typeof activateFirstRound;
};

// Deferred for the same reason as every other owner action in this
// codebase -- statically importing require-user.ts would eagerly load
// next/navigation's redirect(), which crashes when evaluated outside a
// real Next.js server runtime (e.g. under the plain Node test harness's
// --conditions=react-server flag). Every test in
// activate-first-round.test.ts supplies its own requireUser mock and
// never reaches this function.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: ActivateFirstRoundDependencies = {
  requireUser: requireRealUser,
  activateFirstRound,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";
const NOT_ACTIVE_MESSAGE = "This circle cannot start its rounds right now.";
const INTEGRITY_MESSAGE = "We couldn't safely start this round because its saved records are inconsistent.";
const GENERIC_FAILURE_MESSAGE = "We could not start this round. Please try again.";

/**
 * Starts round 1 of the owner's own already-ACTIVE circle. requireUser()
 * runs first, before any input is read or trusted -- an unauthenticated
 * submission is denied outright, and ownerId comes exclusively from that
 * call, never from the form. circleId is read from the form but is
 * independently re-verified by activateFirstRound itself (fresh
 * ownership, under the circle-row lock); a forged circleId is rejected
 * there, not trusted here.
 */
export async function runActivateFirstRoundAction(
  formData: FormData,
  dependencies: Partial<ActivateFirstRoundDependencies> = {},
): Promise<ActivateFirstRoundActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  if (circleId.length === 0) {
    return { formError: GENERIC_NOT_FOUND_MESSAGE };
  }

  try {
    const result = await deps.activateFirstRound({ ownerId: user.id, circleId });
    return {
      status: "success",
      message: `Round ${result.round.roundNumber} is active.`,
      round: result.round,
    };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    if (error instanceof RoundLifecycleCircleNotFoundError || error instanceof RoundLifecycleAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    // Ownership is already established once we reach this branch, so it
    // is safe to state plainly that the circle simply is not ready yet --
    // never phrased as if anything is broken.
    if (error instanceof RoundLifecycleCircleNotActiveError) {
      return { formError: NOT_ACTIVE_MESSAGE };
    }
    // Integrity failures are a distinct class from "not ready yet": they
    // mean the circle's own saved round history contradicts itself, never
    // something the owner can simply wait out or retry into succeeding.
    if (error instanceof RoundLifecycleIntegrityError || error instanceof PayoutAccountingIntegrityError) {
      return { formError: INTEGRITY_MESSAGE };
    }

    console.error(
      "[activateFirstRoundAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: GENERIC_FAILURE_MESSAGE };
  }
}
