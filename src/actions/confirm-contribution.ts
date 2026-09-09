import {
  confirmContribution,
  ContributionConfirmationAmountIntegrityError,
  ContributionConfirmationAuthorizationError,
  ContributionConfirmationCircleNotActiveError,
  ContributionConfirmationCircleNotFoundError,
  ContributionConfirmationCurrencyIntegrityError,
  ContributionConfirmationIntegrityConflictError,
  ContributionConfirmationObligationNotFoundError,
  ContributionConfirmationPaymentNotFoundError,
  ContributionConfirmationPaymentRejectedError,
  ContributionConfirmationUnexpectedObligationStateError,
} from "@/src/services/contribution-confirmation.service";
import { confirmContributionSchema } from "@/src/validations/contribution.schema";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why.
//
// Orchestration boundary only: every financial rule (circle locking,
// ledger-integrity re-verification, the RECORDED -> CONFIRMED
// compare-and-swap, atomic obligation fulfillment, idempotent replay)
// lives entirely inside confirmContribution
// (contribution-confirmation.service.ts, 7J.3) and is never reimplemented
// here.

export type ConfirmContributionActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"paymentId", string[]>>;
  readonly formError?: string;
  readonly payment?: {
    readonly id: string;
    readonly circleId: string;
    readonly obligationId: string;
    readonly amount: string;
    readonly currency: string;
    readonly status: "CONFIRMED";
    readonly confirmedAt: string;
    readonly confirmedById: string;
  };
  readonly obligation?: {
    readonly id: string;
    readonly status: "FULFILLED";
    readonly fulfilledAt: string;
  };
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type ConfirmContributionDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly confirmContribution: typeof confirmContribution;
};

async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: ConfirmContributionDependencies = {
  requireUser: requireRealUser,
  confirmContribution,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";

/**
 * Confirms an already-RECORDED contribution payment. requireUser() runs
 * first; ownerId comes exclusively from that call. circleId and paymentId
 * are read from the form, but both are independently re-verified by
 * confirmContribution itself -- a foreign or nonexistent paymentId
 * collapses to the identical not-found outcome inside the service (7J.3
 * section 11's "do not expose whether a foreign owner's payment exists"),
 * so this action does not need, and does not add, a second layer of that
 * collapsing.
 */
export async function runConfirmContributionAction(
  formData: FormData,
  dependencies: Partial<ConfirmContributionDependencies> = {},
): Promise<ConfirmContributionActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const parsed = confirmContributionSchema.safeParse({
    paymentId: formData.get("paymentId"),
  });

  if (circleId.length === 0) {
    return { formError: GENERIC_NOT_FOUND_MESSAGE };
  }
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await deps.confirmContribution({ ownerId: user.id, circleId, input: parsed.data });
    return {
      status: "success",
      payment: {
        id: result.payment.id,
        circleId: result.payment.circleId,
        obligationId: result.payment.obligationId,
        amount: result.payment.amount,
        currency: result.payment.currency,
        status: result.payment.status,
        confirmedAt: result.payment.confirmedAt,
        confirmedById: result.payment.confirmedById,
      },
      obligation: {
        id: result.obligation.id,
        status: result.obligation.status,
        fulfilledAt: result.obligation.fulfilledAt,
      },
    };
  } catch (error) {
    if (error instanceof ContributionConfirmationCircleNotFoundError || error instanceof ContributionConfirmationAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    if (error instanceof ContributionConfirmationPaymentNotFoundError) {
      return { formError: "We could not find this contribution payment." };
    }
    if (
      error instanceof ContributionConfirmationCircleNotActiveError ||
      error instanceof ContributionConfirmationPaymentRejectedError ||
      error instanceof ContributionConfirmationObligationNotFoundError ||
      error instanceof ContributionConfirmationAmountIntegrityError ||
      error instanceof ContributionConfirmationCurrencyIntegrityError ||
      error instanceof ContributionConfirmationUnexpectedObligationStateError ||
      error instanceof ContributionConfirmationIntegrityConflictError
    ) {
      return { formError: error.message };
    }

    console.error(
      "[confirmContributionAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not confirm this contribution. Please try again." };
  }
}
