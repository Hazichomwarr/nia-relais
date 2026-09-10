import { requireCircleMember } from "@/src/auth/require-circle-member";
import {
  InvalidDisputeReasonError,
  PayoutAccountingIntegrityError,
  PayoutDisputeAccountingIntegrityError,
  PayoutDisputeCircleNotActiveError,
  PayoutDisputeConfirmedError,
  PayoutDisputeIntentConflictError,
  PayoutDisputeNotFoundError,
  PayoutDisputeProvenanceIntegrityError,
  PayoutDisputeReplayIntegrityError,
  PayoutDisputeUnauthorizedError,
  disputePayout,
} from "@/src/services/payout-dispute.service";
import { disputePayoutSchema } from "@/src/validations/payout.schema";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why. Member-facing
// counterpart to confirm-payout.ts, authenticated the same way
// (requireCircleMember, never requireUser -- 7K.4/7K.5's own architecture
// boundary is never crossed here).
//
// Orchestration boundary only: every financial rule (circle locking,
// recipient-authority verification, ledger-integrity re-verification, the
// RECORDED -> DISPUTED compare-and-swap, exact-intent idempotent replay)
// lives entirely inside disputePayout (payout-dispute.service.ts, 7K.5)
// and is never reimplemented here. This action performs no dispute
// adjudication or interpretation of its own -- disputeReason is forwarded
// exactly as disputePayoutSchema normalizes it, never inspected or
// rewritten.

export type DisputePayoutActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"payoutId" | "disputeReason", string[]>>;
  readonly formError?: string;
  readonly payout?: {
    readonly id: string;
    readonly circleId: string;
    readonly roundId: string;
    readonly amount: string;
    readonly currency: string;
    readonly status: "DISPUTED";
    readonly recordedAt: string;
    readonly recordedById: string;
    readonly disputedAt: string;
    readonly disputedByMemberId: string;
    readonly disputeReason: string;
  };
};

export type TrustedMember = { readonly circleId: string; readonly memberId: string };

export type DisputePayoutDependencies = {
  readonly requireCircleMember: (circleId: string) => Promise<TrustedMember>;
  readonly disputePayout: typeof disputePayout;
};

const defaultDependencies: DisputePayoutDependencies = {
  requireCircleMember,
  disputePayout,
};

/**
 * Disputes the recipient's own already-RECORDED payout. circleId is read
 * from the form and handed, unconditionally, to requireCircleMember --
 * which redirects to /member/login for any failure, exactly like
 * confirm-payout.ts's own runConfirmPayoutAction. memberId comes
 * exclusively from that call's returned identity, never from the form.
 * Only payoutId and disputeReason are whitelisted through
 * disputePayoutSchema before disputePayout is ever called -- no
 * memberId/recipientId/actor-id field is ever read from the form, and
 * proving PayoutRound.recipientId === memberId remains entirely the
 * service's own job.
 */
export async function runDisputePayoutAction(
  formData: FormData,
  dependencies: Partial<DisputePayoutDependencies> = {},
): Promise<DisputePayoutActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const circleId = String(formData.get("circleId") ?? "").trim();
  const identity = await deps.requireCircleMember(circleId);

  const parsed = disputePayoutSchema.safeParse({
    payoutId: formData.get("payoutId"),
    disputeReason: formData.get("disputeReason"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await deps.disputePayout({
      circleId: identity.circleId,
      memberId: identity.memberId,
      input: parsed.data,
    });
    return {
      status: "success",
      payout: {
        id: result.id,
        circleId: result.circleId,
        roundId: result.roundId,
        amount: result.amount,
        currency: result.currency,
        status: result.status,
        recordedAt: result.recordedAt,
        recordedById: result.recordedById,
        disputedAt: result.disputedAt,
        disputedByMemberId: result.disputedByMemberId,
        disputeReason: result.disputeReason,
      },
    };
  } catch (error) {
    if (error instanceof PayoutDisputeNotFoundError) {
      return { formError: "We could not find this payout." };
    }
    if (
      error instanceof PayoutDisputeUnauthorizedError ||
      error instanceof PayoutDisputeCircleNotActiveError ||
      error instanceof PayoutDisputeConfirmedError ||
      error instanceof PayoutDisputeIntentConflictError ||
      error instanceof InvalidDisputeReasonError ||
      error instanceof PayoutDisputeAccountingIntegrityError ||
      error instanceof PayoutDisputeProvenanceIntegrityError ||
      error instanceof PayoutDisputeReplayIntegrityError ||
      error instanceof PayoutAccountingIntegrityError
    ) {
      return { formError: error.message };
    }

    console.error(
      "[disputePayoutAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not record this dispute. Please try again." };
  }
}
