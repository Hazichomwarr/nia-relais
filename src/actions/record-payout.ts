import {
  InvalidPayoutAmountError,
  PayoutAccountingIntegrityError,
  PayoutAlreadyRecordedError,
  PayoutAmountMismatchError,
  PayoutRecordingAuthorizationError,
  PayoutRecordingCircleNotActiveError,
  PayoutRecordingCircleNotFoundError,
  PayoutRecordingConflictError,
  PayoutRecordingIntegrityConflictError,
  PayoutRecordingOperationConflictError,
  PayoutRecordingRoundNotFoundError,
  recordPayout,
} from "@/src/services/payout-recording.service";
import { recordPayoutSchema } from "@/src/validations/payout.schema";

// Testable core, deliberately not a "use server" file -- see
// add-draft-circle-member.ts's own comment for why.
//
// Orchestration boundary only: every financial rule (circle locking,
// obligation-sum amount authority, one-payout-per-round, idempotent
// replay) lives entirely inside recordPayout
// (payout-recording.service.ts, 7K.3) and is never reimplemented or
// duplicated here. This action computes nothing -- no amount, no
// currency, no obligation inspection, no round-status inspection -- it
// only authenticates, whitelists three form fields, and maps the
// service's own result/errors into a safe action state.
//
// clientOperationId is read from the form and forwarded to recordPayout
// completely unchanged -- this action never generates, replaces, or
// rewrites it beyond recordPayoutSchema's own trim, so a genuine retry
// (the same submission, resubmitted by a future client UI) reaches the
// service's own exact-intent replay check with the identity the form
// actually produced.

export type RecordPayoutActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"roundId" | "amount" | "clientOperationId", string[]>>;
  readonly formError?: string;
  readonly payout?: {
    readonly id: string;
    readonly circleId: string;
    readonly roundId: string;
    readonly amount: string;
    readonly currency: string;
    // Not narrowed to "RECORDED": a legitimate replay can surface a
    // payout that has since been CONFIRMED or DISPUTED by a separate
    // operation (payout-recording.service.ts's own
    // RecordedPayoutResult.status) -- this action state must report that
    // truthfully, never force it back to a fresh "RECORDED" the caller
    // did not actually observe.
    readonly status: "RECORDED" | "CONFIRMED" | "DISPUTED";
    readonly clientOperationId: string;
    readonly recordedAt: string;
    readonly recordedById: string;
  };
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type RecordPayoutDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly recordPayout: typeof recordPayout;
};

// Deferred for the same reason as every other owner action in this
// codebase -- statically importing require-user.ts would eagerly load
// next/navigation's redirect(), which crashes when evaluated outside a
// real Next.js server runtime (e.g. under the plain Node test harness's
// --conditions=react-server flag). Every test in record-payout.test.ts
// supplies its own requireUser mock and never reaches this function.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: RecordPayoutDependencies = {
  requireUser: requireRealUser,
  recordPayout,
};

const GENERIC_NOT_FOUND_MESSAGE = "We could not find this circle.";

/**
 * Records the owner's assertion that a round's payout was made
 * externally. requireUser() runs first, before any input is parsed or
 * trusted -- an unauthenticated submission is denied outright, and
 * ownerId comes exclusively from that call, never from the form.
 * circleId is read from the form but is independently re-verified by
 * recordPayout itself (fresh ownership, under the circle-row lock); a
 * forged circleId is rejected there, not trusted here. Nothing about
 * ownerId, recipientId, currency, status, recordedById, recordedAt, round
 * status, or any expected payout amount is ever read from the form --
 * only roundId, amount, and clientOperationId are whitelisted through
 * recordPayoutSchema before recordPayout is ever called.
 */
export async function runRecordPayoutAction(
  formData: FormData,
  dependencies: Partial<RecordPayoutDependencies> = {},
): Promise<RecordPayoutActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const parsed = recordPayoutSchema.safeParse({
    roundId: formData.get("roundId"),
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
    const payout = await deps.recordPayout({ ownerId: user.id, circleId, input: parsed.data });
    return {
      status: "success",
      payout: {
        id: payout.id,
        circleId: payout.circleId,
        roundId: payout.roundId,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        clientOperationId: payout.clientOperationId,
        recordedAt: payout.recordedAt,
        recordedById: payout.recordedById,
      },
    };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    if (error instanceof PayoutRecordingCircleNotFoundError || error instanceof PayoutRecordingAuthorizationError) {
      return { formError: GENERIC_NOT_FOUND_MESSAGE };
    }
    // Ownership of circleId is already established once we reach this
    // branch, so it is safe to state a round-scoped conflict plainly -- it
    // can only mean a stale/incorrect roundId for a circle the caller
    // genuinely owns.
    if (error instanceof PayoutRecordingRoundNotFoundError) {
      return { formError: "We could not find this payout round." };
    }
    if (
      error instanceof PayoutRecordingCircleNotActiveError ||
      error instanceof InvalidPayoutAmountError ||
      error instanceof PayoutAmountMismatchError ||
      error instanceof PayoutAlreadyRecordedError ||
      error instanceof PayoutRecordingOperationConflictError ||
      error instanceof PayoutRecordingIntegrityConflictError ||
      error instanceof PayoutRecordingConflictError ||
      error instanceof PayoutAccountingIntegrityError
    ) {
      return { formError: error.message };
    }

    console.error(
      "[recordPayoutAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not record this payout. Please try again." };
  }
}
