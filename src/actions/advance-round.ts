import {
  PayoutAccountingIntegrityError,
  RoundLifecycleAuthorizationError,
  RoundLifecycleCircleNotActiveError,
  RoundLifecycleCircleNotFoundError,
  RoundLifecycleContributionsIncompleteError,
  RoundLifecycleIntegrityError,
  RoundLifecycleNotCurrentError,
  RoundLifecyclePayoutDisputedError,
  RoundLifecyclePayoutMissingError,
  RoundLifecyclePayoutNotConfirmedError,
  RoundLifecycleRoundNotFoundError,
  advanceRound,
  type AdvanceRoundResult,
  type LifecycleRoundResult,
} from "@/src/services/round-lifecycle.service";
import { advanceRoundSchema } from "@/src/validations/round-lifecycle.schema";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why. Owner-facing, same
// requireUser authentication shape as activate-first-round.ts.
//
// Orchestration boundary only: every rule (ownership, current-round
// targeting, the contribution/payout closure predicate, the atomic
// close-then-activate-successor compare-and-swap pair, replay resolution)
// lives entirely inside advanceRound (round-lifecycle.service.ts, 7K.13)
// and is never reimplemented here. Only circleId and roundId are
// whitelisted through advanceRoundSchema before advanceRound is ever
// called -- no status, no financial-readiness flag, no recipientId, no
// nextRoundId, and no isFinalRound is ever read from the form; the
// service alone decides whether a round is ready to close and what (if
// anything) becomes its successor.
//
// A legitimate replay (the requested round already CLOSED, reported back
// by the service with replayed: true) is surfaced as an ordinary success,
// never converted into an error.
//
// Wording discipline (7K.14): a DISPUTED payout is reported as a
// permanent blocker for this round, never phrased as something to "fix,"
// "retry," or "resolve" -- disputePayout is a member-only decision this
// action has no authority to reverse or route around. A final round's
// closure is reported only as "the final round is closed," never as
// "circle complete"/"SUSU completed"/"savings circle finished" -- circle
// completion is a distinct, unimplemented operation this file has no
// knowledge of (round-lifecycle.service.ts's own AdvanceRoundResult
// exposes isFinalRound as a fact about round sequencing only, not a
// completion event).

export type AdvanceRoundActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"roundId", string[]>>;
  readonly formError?: string;
  // Truthful, service-derived feedback copy: "Round <n> is now active."
  // when a successor exists, or "The final round is closed." when it does
  // not -- never a generic "success" string that would obscure which of
  // the two genuinely happened.
  readonly message?: string;
  readonly closedRound?: LifecycleRoundResult;
  readonly activatedRound?: LifecycleRoundResult | null;
  readonly isFinalRound?: boolean;
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type AdvanceRoundDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly advanceRound: typeof advanceRound;
};

// Deferred for the same reason as activate-first-round.ts's own
// requireRealUser -- see that file's comment.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: AdvanceRoundDependencies = {
  requireUser: requireRealUser,
  advanceRound,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";
const ROUND_NOT_FOUND_MESSAGE = "We could not find this payout round.";
const NOT_CURRENT_MESSAGE = "Only the circle's current round can be advanced.";
const CIRCLE_NOT_ACTIVE_MESSAGE = "This circle is not active, so its rounds cannot be advanced right now.";
const CONTRIBUTIONS_INCOMPLETE_MESSAGE =
  "All contributions for this round must be confirmed before it can be closed.";
const PAYOUT_MISSING_MESSAGE = "The payout must be recorded and confirmed before this round can be closed.";
const PAYOUT_NOT_CONFIRMED_MESSAGE = "The recipient still needs to confirm the payout.";
const PAYOUT_DISPUTED_MESSAGE = "This payout was disputed, so this round cannot advance in NIA.";
const INTEGRITY_MESSAGE = "We couldn't safely advance this round because its saved records are inconsistent.";
const GENERIC_FAILURE_MESSAGE = "We could not advance this round. Please try again.";

function successMessage(result: AdvanceRoundResult): string {
  if (result.activatedRound) {
    return `Round ${result.activatedRound.roundNumber} is now active.`;
  }
  return "The final round is closed.";
}

/**
 * Advances the owner's own circle past its requested current round.
 * requireUser() runs first, before any input is read or trusted --
 * ownerId comes exclusively from that call, never from the form.
 * circleId is read raw (non-empty check only, exactly like every other
 * owner action); roundId is the sole field validated through
 * advanceRoundSchema. Both are independently re-verified by advanceRound
 * itself (fresh ownership and fresh round lookup, under the circle-row
 * lock); forged values are rejected there, not trusted here.
 */
export async function runAdvanceRoundAction(
  formData: FormData,
  dependencies: Partial<AdvanceRoundDependencies> = {},
): Promise<AdvanceRoundActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const parsed = advanceRoundSchema.safeParse({
    roundId: formData.get("roundId"),
  });

  if (circleId.length === 0) {
    return { formError: GENERIC_NOT_FOUND_MESSAGE };
  }
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await deps.advanceRound({ ownerId: user.id, circleId, roundId: parsed.data.roundId });
    return {
      status: "success",
      message: successMessage(result),
      closedRound: result.closedRound,
      activatedRound: result.activatedRound,
      isFinalRound: result.isFinalRound,
    };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    if (error instanceof RoundLifecycleCircleNotFoundError || error instanceof RoundLifecycleAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    // Ownership of circleId is already established once we reach this
    // branch, so it is safe to state a round-scoped conflict plainly.
    if (error instanceof RoundLifecycleRoundNotFoundError) {
      return { formError: ROUND_NOT_FOUND_MESSAGE };
    }
    if (error instanceof RoundLifecycleNotCurrentError) {
      return { formError: NOT_CURRENT_MESSAGE };
    }
    if (error instanceof RoundLifecycleCircleNotActiveError) {
      return { formError: CIRCLE_NOT_ACTIVE_MESSAGE };
    }
    // "Not ready yet" business blockers -- each reported with its own
    // distinct, specific copy, never collapsed into one generic "not
    // ready" message. None of these imply anything is broken.
    if (error instanceof RoundLifecycleContributionsIncompleteError) {
      return { formError: CONTRIBUTIONS_INCOMPLETE_MESSAGE };
    }
    if (error instanceof RoundLifecyclePayoutMissingError) {
      return { formError: PAYOUT_MISSING_MESSAGE };
    }
    if (error instanceof RoundLifecyclePayoutNotConfirmedError) {
      return { formError: PAYOUT_NOT_CONFIRMED_MESSAGE };
    }
    // A disputed payout is a permanent blocker, not a "not ready yet"
    // state -- worded so it never implies the owner can fix, retry, or
    // resolve it from here.
    if (error instanceof RoundLifecyclePayoutDisputedError) {
      return { formError: PAYOUT_DISPUTED_MESSAGE };
    }
    // Integrity failures are a distinct class from every "not ready yet"
    // blocker above: they mean the circle's own saved records contradict
    // each other, never something the owner can simply wait out.
    if (error instanceof RoundLifecycleIntegrityError || error instanceof PayoutAccountingIntegrityError) {
      return { formError: INTEGRITY_MESSAGE };
    }

    console.error(
      "[advanceRoundAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: GENERIC_FAILURE_MESSAGE };
  }
}
