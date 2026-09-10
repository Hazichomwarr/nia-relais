import { requireCircleMember } from "@/src/auth/require-circle-member";
import {
  PayoutAccountingIntegrityError,
  PayoutConfirmationAccountingIntegrityError,
  PayoutConfirmationCircleNotActiveError,
  PayoutConfirmationDisputedError,
  PayoutConfirmationNotFoundError,
  PayoutConfirmationProvenanceIntegrityError,
  PayoutConfirmationReplayIntegrityError,
  PayoutConfirmationUnauthorizedError,
  confirmPayout,
} from "@/src/services/payout-confirmation.service";
import { confirmPayoutSchema } from "@/src/validations/payout.schema";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why. Member-facing
// counterpart to confirm-contribution.ts/reject-contribution.ts, but
// authenticated by requireCircleMember (member-session identity) instead
// of requireUser (platform User identity) -- these two identity systems
// are never merged (7K.4/7K.5's own architecture boundary).
//
// Orchestration boundary only: every financial rule (circle locking,
// recipient-authority verification, ledger-integrity re-verification, the
// RECORDED -> CONFIRMED compare-and-swap, idempotent replay) lives
// entirely inside confirmPayout (payout-confirmation.service.ts, 7K.4)
// and is never reimplemented here. This action never decides recipient
// authority itself -- PayoutRound.recipientId === memberId is the
// service's own check, not this file's.
//
// requireCircleMember is imported and called directly (not deferred via
// dynamic import, unlike requireUser): unlike require-user.ts, it does
// not eagerly load next/navigation at module scope (its own redirect() is
// deferred internally via createRequire -- see require-circle-member.ts's
// own comment), so it is already safe to import under the plain Node test
// harness. Every test in confirm-payout.test.ts still supplies its own
// mock, exactly like every other action in this ticket sequence.

export type ConfirmPayoutActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"payoutId", string[]>>;
  readonly formError?: string;
  readonly payout?: {
    readonly id: string;
    readonly circleId: string;
    readonly roundId: string;
    readonly amount: string;
    readonly currency: string;
    readonly status: "CONFIRMED";
    readonly recordedAt: string;
    readonly recordedById: string;
    readonly confirmedAt: string;
    readonly confirmedByMemberId: string;
  };
};

export type TrustedMember = { readonly circleId: string; readonly memberId: string };

export type ConfirmPayoutDependencies = {
  readonly requireCircleMember: (circleId: string) => Promise<TrustedMember>;
  readonly confirmPayout: typeof confirmPayout;
};

const defaultDependencies: ConfirmPayoutDependencies = {
  requireCircleMember,
  confirmPayout,
};

/**
 * Confirms the recipient's own already-RECORDED payout. circleId is read
 * from the form and handed, unconditionally, to requireCircleMember --
 * which redirects to /member/login for any failure (no session, expired/
 * revoked, removed member, ineligible circle, or a circleId that does not
 * match the session's own trusted circleId) without this action ever
 * needing a separate "empty circleId" short-circuit of its own. memberId
 * comes exclusively from that call's returned identity, never from the
 * form -- there is no memberId/recipientId field anywhere in this
 * action's own input handling. Only payoutId is whitelisted through
 * confirmPayoutSchema before confirmPayout is ever called; proving
 * PayoutRound.recipientId === memberId remains entirely the service's own
 * job.
 */
export async function runConfirmPayoutAction(
  formData: FormData,
  dependencies: Partial<ConfirmPayoutDependencies> = {},
): Promise<ConfirmPayoutActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const circleId = String(formData.get("circleId") ?? "").trim();
  const identity = await deps.requireCircleMember(circleId);

  const parsed = confirmPayoutSchema.safeParse({
    payoutId: formData.get("payoutId"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await deps.confirmPayout({
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
        confirmedAt: result.confirmedAt,
        confirmedByMemberId: result.confirmedByMemberId,
      },
    };
  } catch (error) {
    if (error instanceof PayoutConfirmationNotFoundError) {
      return { formError: "We could not find this payout." };
    }
    if (
      error instanceof PayoutConfirmationUnauthorizedError ||
      error instanceof PayoutConfirmationCircleNotActiveError ||
      error instanceof PayoutConfirmationDisputedError ||
      error instanceof PayoutConfirmationAccountingIntegrityError ||
      error instanceof PayoutConfirmationProvenanceIntegrityError ||
      error instanceof PayoutConfirmationReplayIntegrityError ||
      error instanceof PayoutAccountingIntegrityError
    ) {
      return { formError: error.message };
    }

    console.error(
      "[confirmPayoutAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not confirm this payout. Please try again." };
  }
}
