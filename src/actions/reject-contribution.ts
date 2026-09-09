import {
  ContributionRejectionAmountIntegrityError,
  ContributionRejectionAuthorizationError,
  ContributionRejectionCircleNotActiveError,
  ContributionRejectionCircleNotFoundError,
  ContributionRejectionCurrencyIntegrityError,
  ContributionRejectionIntegrityConflictError,
  ContributionRejectionIntentConflictError,
  ContributionRejectionObligationNotFoundError,
  ContributionRejectionPaymentConfirmedError,
  ContributionRejectionPaymentNotFoundError,
  ContributionRejectionUnexpectedObligationStateError,
  InvalidRejectionReasonError,
  rejectContribution,
} from "@/src/services/contribution-rejection.service";
import { rejectContributionSchema } from "@/src/validations/contribution.schema";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why.
//
// Orchestration boundary only: every financial rule (circle locking,
// ledger-integrity re-verification, the RECORDED -> REJECTED
// compare-and-swap, exact-intent idempotent replay) lives entirely inside
// rejectContribution (contribution-rejection.service.ts, 7J.4/7J.4.1) and
// is never reimplemented here.

export type RejectContributionActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"paymentId" | "rejectionReason", string[]>>;
  readonly formError?: string;
  readonly payment?: {
    readonly id: string;
    readonly circleId: string;
    readonly obligationId: string;
    readonly amount: string;
    readonly currency: string;
    readonly status: "REJECTED";
    readonly rejectedAt: string;
    readonly rejectedById: string;
    readonly rejectionReason: string;
  };
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type RejectContributionDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly rejectContribution: typeof rejectContribution;
};

async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: RejectContributionDependencies = {
  requireUser: requireRealUser,
  rejectContribution,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";

/**
 * Rejects an already-RECORDED contribution payment. requireUser() runs
 * first; ownerId comes exclusively from that call. circleId and paymentId
 * are read from the form; rejectionReason is required and non-empty at
 * the schema layer (rejectContributionSchema) before this action ever
 * calls the service -- the service's own InvalidRejectionReasonError is
 * mapped defensively below anyway, matching the "never trust client-side
 * validation alone" discipline this ticket sequence has followed
 * throughout, even though it should be structurally unreachable here.
 */
export async function runRejectContributionAction(
  formData: FormData,
  dependencies: Partial<RejectContributionDependencies> = {},
): Promise<RejectContributionActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const parsed = rejectContributionSchema.safeParse({
    paymentId: formData.get("paymentId"),
    rejectionReason: formData.get("rejectionReason"),
  });

  if (circleId.length === 0) {
    return { formError: GENERIC_NOT_FOUND_MESSAGE };
  }
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const payment = await deps.rejectContribution({ ownerId: user.id, circleId, input: parsed.data });
    return {
      status: "success",
      payment: {
        id: payment.id,
        circleId: payment.circleId,
        obligationId: payment.obligationId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        rejectedAt: payment.rejectedAt,
        rejectedById: payment.rejectedById,
        rejectionReason: payment.rejectionReason,
      },
    };
  } catch (error) {
    if (error instanceof ContributionRejectionCircleNotFoundError || error instanceof ContributionRejectionAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    if (error instanceof ContributionRejectionPaymentNotFoundError) {
      return { formError: "We could not find this contribution payment." };
    }
    if (
      error instanceof ContributionRejectionCircleNotActiveError ||
      error instanceof ContributionRejectionPaymentConfirmedError ||
      error instanceof ContributionRejectionObligationNotFoundError ||
      error instanceof ContributionRejectionAmountIntegrityError ||
      error instanceof ContributionRejectionCurrencyIntegrityError ||
      error instanceof ContributionRejectionUnexpectedObligationStateError ||
      error instanceof ContributionRejectionIntegrityConflictError ||
      error instanceof ContributionRejectionIntentConflictError ||
      error instanceof InvalidRejectionReasonError
    ) {
      return { formError: error.message };
    }

    console.error(
      "[rejectContributionAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not reject this contribution. Please try again." };
  }
}
