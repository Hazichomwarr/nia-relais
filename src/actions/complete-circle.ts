import {
  CircleCompletionAuthorizationError,
  CircleCompletionIntegrityError,
  CircleCompletionNotActiveError,
  CircleCompletionNotFoundError,
  CircleCompletionRoundsIncompleteError,
  PayoutAccountingIntegrityError,
  completeCircle,
} from "@/src/services/circle-completion.service";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why. Owner-facing, same
// requireUser authentication shape as activate-first-round.ts/
// advance-round.ts -- never requireCircleMember, never a member-session
// identity of any kind.
//
// Orchestration boundary only: every rule (ownership, the "circle must
// already be ACTIVE with every round CLOSED" precondition, the financial
// revalidation, the fresh-vs-replay resolution, the ACTIVE -> COMPLETED
// compare-and-swap) lives entirely inside completeCircle
// (circle-completion.service.ts, 7L.1) and is never reimplemented,
// duplicated, or second-guessed here. This action reads no round,
// obligation, payment, or payout data at all, computes no date, and
// inspects no circle status of its own to pre-judge readiness -- circleId
// is the ONLY field this action accepts, exactly like
// activateFirstRound's own single-field contract.
//
// A legitimate replay (the circle already COMPLETED, reported back by the
// service with replayed: true) is surfaced as an ordinary success, never
// converted into an error, and never distinguished from a fresh
// completion in the returned state -- no existing action convention in
// this codebase requires that distinction to reach the client (7L.2
// section 6).
//
// Product-copy discipline (7L frozen contract, docs/product/susu-circle
// -completion-audit.md §30): the success message is exactly "The circle
// is complete." -- never "payment completed," "money transferred," or
// any phrasing implying NIA itself moved funds.

export type CompleteCircleActionState = {
  readonly status?: "success";
  readonly formError?: string;
  // Truthful, frozen product copy only -- never internal integrity
  // details, never a raw Prisma model, never completedById/completedAt
  // (7L.2 section 6: the client does not yet need this, and no UI exists
  // to render it in this ticket).
  readonly message?: string;
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type CompleteCircleDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly completeCircle: typeof completeCircle;
};

// Deferred for the same reason as every other owner action in this
// codebase -- statically importing require-user.ts would eagerly load
// next/navigation's redirect(), which crashes when evaluated outside a
// real Next.js server runtime (e.g. under the plain Node test harness's
// --conditions=react-server flag). Every test in complete-circle.test.ts
// supplies its own requireUser mock and never reaches this function.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: CompleteCircleDependencies = {
  requireUser: requireRealUser,
  completeCircle,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";
const NOT_ACTIVE_MESSAGE = "This circle cannot be completed right now.";
const ROUNDS_INCOMPLETE_MESSAGE = "Every round in this circle's rotation must be closed before it can be completed.";
const INTEGRITY_MESSAGE = "We couldn't safely complete this circle because its saved records are inconsistent.";
const GENERIC_FAILURE_MESSAGE = "We could not complete this circle. Please try again.";
const SUCCESS_MESSAGE = "The circle is complete.";

/**
 * Explicitly, owner-only completes the owner's own circle whose entire
 * rotation has closed. requireUser() runs first, before any input is read
 * or trusted -- an unauthenticated submission is denied outright, and
 * ownerId comes exclusively from that call, never from the form. circleId
 * is read from the form but is independently re-verified by completeCircle
 * itself (fresh ownership, under the circle-row lock); a forged circleId
 * is rejected there, not trusted here.
 */
export async function runCompleteCircleAction(
  formData: FormData,
  dependencies: Partial<CompleteCircleDependencies> = {},
): Promise<CompleteCircleActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  if (circleId.length === 0) {
    return { formError: GENERIC_NOT_FOUND_MESSAGE };
  }

  try {
    await deps.completeCircle({ ownerId: user.id, circleId });
    return { status: "success", message: SUCCESS_MESSAGE };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    if (error instanceof CircleCompletionNotFoundError || error instanceof CircleCompletionAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    // Ownership is already established once we reach this branch, so it
    // is safe to state plainly that the circle simply is not eligible yet
    // -- never phrased as if anything is broken.
    if (error instanceof CircleCompletionNotActiveError) {
      return { formError: NOT_ACTIVE_MESSAGE };
    }
    // An ordinary, waitable business state -- distinct from every
    // integrity failure below, and never collapsed into it.
    if (error instanceof CircleCompletionRoundsIncompleteError) {
      return { formError: ROUNDS_INCOMPLETE_MESSAGE };
    }
    // Integrity failures are a distinct class from "not ready yet": they
    // mean the circle's own saved rotation history contradicts itself,
    // never something the owner can simply wait out or retry into
    // succeeding. Never collapsed into ROUNDS_INCOMPLETE_MESSAGE.
    if (error instanceof CircleCompletionIntegrityError || error instanceof PayoutAccountingIntegrityError) {
      return { formError: INTEGRITY_MESSAGE };
    }

    console.error(
      "[completeCircleAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: GENERIC_FAILURE_MESSAGE };
  }
}
