import {
  ContributionAmountMismatchError,
  ContributionObligationAlreadyFulfilledError,
  ContributionObligationAlreadyRecordedError,
  ContributionObligationNotFoundError,
  ContributionOperationConflictError,
  ContributionRecordingAuthorizationError,
  ContributionRecordingCircleNotActiveError,
  ContributionRecordingCircleNotFoundError,
  ContributionRecordingConflictError,
  InvalidContributionAmountError,
  recordContribution,
} from "@/src/services/contribution-recording.service";
import { recordContributionSchema } from "@/src/validations/contribution.schema";

// Testable core, deliberately not a "use server" file -- same split as
// every other owner action in this ticket sequence (see
// add-draft-circle-member.ts's own comment for why).
//
// This action is an orchestration boundary only: requireUser(), form
// validation, and safe error mapping live here; every financial rule
// (circle locking, exact-amount comparison, obligation eligibility,
// idempotent replay, the partial-index race backstop) lives entirely
// inside recordContribution (contribution-recording.service.ts, 7J.2) and
// is never reimplemented or duplicated here.
//
// clientOperationId is read from the form and forwarded to
// recordContribution completely unchanged -- this action never generates
// or rewrites it, so a genuine retry (the same submission, resubmitted)
// reaches the service's own exact-intent replay check with the identity
// the form actually produced, not a fresh one that would defeat it.

export type RecordContributionActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"obligationId" | "amount" | "clientOperationId", string[]>>;
  readonly formError?: string;
  readonly payment?: {
    readonly id: string;
    readonly obligationId: string;
    readonly amount: string;
    readonly currency: string;
    // Not narrowed to "RECORDED": a legitimate replay can surface a
    // payment that has since been CONFIRMED or REJECTED by a separate
    // operation (contribution-recording.service.ts's own
    // RecordedContributionResult.status) -- this action state must report
    // that truthfully, never claim a fresh RECORDED status it did not
    // observe.
    readonly status: "RECORDED" | "CONFIRMED" | "REJECTED";
  };
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type RecordContributionDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly recordContribution: typeof recordContribution;
};

// Deferred for the same reason as every other action in this sequence --
// see add-draft-circle-member.ts's own comment.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: RecordContributionDependencies = {
  requireUser: requireRealUser,
  recordContribution,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";

/**
 * Records an owner-submitted contribution against one obligation.
 * requireUser() runs first, before any validation -- an unauthenticated
 * submission is denied outright. ownerId comes exclusively from that
 * call; circleId and obligationId are read from the form, but both are
 * independently re-verified by recordContribution itself (circle
 * ownership/lifecycle, and the obligation's own circle scoping) -- a
 * forged circleId or obligationId is rejected there, not trusted here.
 * Nothing about ownerId, memberId, roundId, currency, expectedAmount,
 * status, or any actor/timestamp provenance is ever read from the form.
 */
export async function runRecordContributionAction(
  formData: FormData,
  dependencies: Partial<RecordContributionDependencies> = {},
): Promise<RecordContributionActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const parsed = recordContributionSchema.safeParse({
    obligationId: formData.get("obligationId"),
    amount: formData.get("amount"),
    clientOperationId: formData.get("clientOperationId"),
  });

  if (circleId.length === 0) {
    return { formError: GENERIC_NOT_FOUND_MESSAGE };
  }
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const payment = await deps.recordContribution({ ownerId: user.id, circleId, input: parsed.data });
    return {
      status: "success",
      payment: {
        id: payment.id,
        obligationId: payment.obligationId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
      },
    };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    if (error instanceof ContributionRecordingCircleNotFoundError || error instanceof ContributionRecordingAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    // Ownership of circleId is already established once we reach this
    // branch, so it is safe to state an obligation-scoped conflict
    // plainly -- it can only mean a stale/incorrect obligationId for a
    // circle the caller genuinely owns, never information about someone
    // else's circle.
    if (error instanceof ContributionObligationNotFoundError) {
      return { formError: "We could not find this contribution obligation." };
    }
    if (
      error instanceof ContributionRecordingCircleNotActiveError ||
      error instanceof InvalidContributionAmountError ||
      error instanceof ContributionAmountMismatchError ||
      error instanceof ContributionObligationAlreadyFulfilledError ||
      error instanceof ContributionObligationAlreadyRecordedError ||
      error instanceof ContributionOperationConflictError ||
      error instanceof ContributionRecordingConflictError
    ) {
      return { formError: error.message };
    }

    console.error(
      "[recordContributionAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not record this contribution. Please try again." };
  }
}
