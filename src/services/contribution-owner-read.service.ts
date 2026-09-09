import "server-only";

import { Prisma } from "@prisma/client";

import { clampToZero, toMoney } from "@/src/domain/contribution-accounting";
import {
  findCircleForOwnerContributions,
  findObligationsForOwnerContributions,
  findPaymentsForOwnerContributions,
  findRoundsForOwnerContributions,
  type OwnerContributionsPaymentRecord,
} from "@/src/repositories/contribution-owner-read.repository";

// Read-only owner-facing SUSU contribution read model (7J.5). Answers
// "what is expected, what has been recorded, what is confirmed, what was
// rejected, what remains outstanding" for one ACTIVE circle, optionally
// narrowed to one round. No mutation anywhere in this file -- see
// contribution-recording/confirmation/rejection.service.ts for the
// writers this read model observes.
//
// Historical authority: every fact returned here comes straight from the
// persisted ContributionObligation/ContributionPayment rows -- never
// reconstructed from current member order, circle terms, round due dates,
// or "the existence of a RECORDED payment." Accounting totals are derived
// live from the payment ledger (never obligation.status alone, matching
// the 7H/7J audit's repeated finding that ContributionObligation.status
// must never be trusted as sole payment truth) -- both the persisted
// status AND the ledger-derived amounts are returned side by side,
// deliberately not merged into a single boolean, so an owner (or a future
// UI) can see when they disagree rather than have that disagreement
// silently hidden.

export class OwnerContributionsCircleNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "OwnerContributionsCircleNotFoundError";
  }
}

export class OwnerContributionsAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to view contributions for this circle.");
    this.name = "OwnerContributionsAuthorizationError";
  }
}

export class OwnerContributionsCircleNotActiveError extends Error {
  constructor() {
    super("Contribution details are only available for an active circle.");
    this.name = "OwnerContributionsCircleNotActiveError";
  }
}

export class OwnerContributionsRoundNotFoundError extends Error {
  constructor() {
    super("Round not found for this circle.");
    this.name = "OwnerContributionsRoundNotFoundError";
  }
}

export type OwnerContributionsCircleResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly status: "ACTIVE";
};

export type OwnerContributionsRoundResult = {
  readonly id: string;
  readonly roundNumber: number;
  readonly recipientDisplayName: string;
  readonly dueDate: string;
  readonly status: string;
};

export type OwnerContributionsObligationResult = {
  readonly id: string;
  readonly roundId: string;
  readonly memberId: string;
  readonly memberDisplayName: string;
  readonly memberCode: string;
  readonly expectedAmount: string;
  readonly currency: string;
  readonly dueDate: string;
  // Persisted, as-is -- never trusted as payment truth on its own (see
  // module comment). Returned alongside, not instead of, the ledger-
  // derived confirmedAmount/outstandingAmount below.
  readonly status: "OPEN" | "FULFILLED";
  readonly fulfilledAt: string | null;
  readonly confirmedAmount: string;
  readonly outstandingAmount: string;
};

export type OwnerContributionsPaymentResult = {
  readonly id: string;
  readonly obligationId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: "RECORDED" | "CONFIRMED" | "REJECTED";
  readonly clientOperationId: string;
  readonly recordedAt: string;
  readonly recordedById: string;
  readonly confirmedAt: string | null;
  readonly confirmedById: string | null;
  readonly rejectedAt: string | null;
  readonly rejectedById: string | null;
  readonly rejectionReason: string | null;
};

export type OwnerCircleContributionsResult = {
  readonly circle: OwnerContributionsCircleResult;
  readonly rounds: readonly OwnerContributionsRoundResult[];
  readonly obligations: readonly OwnerContributionsObligationResult[];
  readonly payments: readonly OwnerContributionsPaymentResult[];
};

function serializePayment(payment: OwnerContributionsPaymentRecord): OwnerContributionsPaymentResult {
  return {
    id: payment.id,
    obligationId: payment.obligationId,
    amount: toMoney(payment.amount),
    currency: payment.currency,
    status: payment.status,
    clientOperationId: payment.clientOperationId,
    recordedAt: payment.recordedAt.toISOString(),
    recordedById: payment.recordedById,
    confirmedAt: payment.confirmedAt?.toISOString() ?? null,
    confirmedById: payment.confirmedById,
    rejectedAt: payment.rejectedAt?.toISOString() ?? null,
    rejectedById: payment.rejectedById,
    rejectionReason: payment.rejectionReason,
  };
}

/**
 * Reads the owner-facing contribution detail for one ACTIVE circle:
 * frozen obligation terms, the full persisted rotation, and the complete
 * payment ledger (RECORDED/CONFIRMED/REJECTED alike, including history
 * that predates a later successful payment). Optionally narrowed to one
 * roundId -- a foreign or nonexistent roundId is rejected identically
 * (OwnerContributionsRoundNotFoundError), since findRoundsForOwnerContributions
 * is already circle-scoped and a foreign round simply never appears in it.
 *
 * confirmedAmount/outstandingAmount are computed here, in application
 * code, from the SAME payment rows returned in the `payments` array --
 * not from a second, separately-aggregated query -- so the totals shown
 * are guaranteed consistent with the visible history, never a
 * independently-stale aggregate.
 */
export async function getOwnerCircleContributions(params: {
  ownerId: string;
  circleId: string;
  roundId?: string;
}): Promise<OwnerCircleContributionsResult> {
  const { ownerId, circleId, roundId } = params;

  const circle = await findCircleForOwnerContributions(circleId);
  if (!circle) throw new OwnerContributionsCircleNotFoundError();
  if (circle.ownerId !== ownerId) throw new OwnerContributionsAuthorizationError();
  if (circle.status !== "ACTIVE") throw new OwnerContributionsCircleNotActiveError();

  const rounds = await findRoundsForOwnerContributions(circleId);

  let selectedRounds = rounds;
  if (roundId !== undefined) {
    const matchingRound = rounds.find((round) => round.id === roundId);
    if (!matchingRound) throw new OwnerContributionsRoundNotFoundError();
    selectedRounds = [matchingRound];
  }

  const obligations = await findObligationsForOwnerContributions(circleId, roundId);
  const payments = await findPaymentsForOwnerContributions(
    circleId,
    obligations.map((obligation) => obligation.id),
  );

  const paymentsByObligationId = new Map<string, OwnerContributionsPaymentRecord[]>();
  for (const payment of payments) {
    const existing = paymentsByObligationId.get(payment.obligationId);
    if (existing) {
      existing.push(payment);
    } else {
      paymentsByObligationId.set(payment.obligationId, [payment]);
    }
  }

  const obligationResults: OwnerContributionsObligationResult[] = obligations.map((obligation) => {
    const obligationPayments = paymentsByObligationId.get(obligation.id) ?? [];
    // RECORDED and REJECTED contribute zero -- excluded by this filter
    // itself, not filtered out after already being summed in.
    const confirmedAmount = obligationPayments
      .filter((payment) => payment.status === "CONFIRMED")
      .reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
    const outstandingAmount = clampToZero(obligation.expectedAmount.minus(confirmedAmount));

    return {
      id: obligation.id,
      roundId: obligation.roundId,
      memberId: obligation.memberId,
      memberDisplayName: obligation.member.displayName,
      memberCode: obligation.member.memberCode,
      expectedAmount: toMoney(obligation.expectedAmount),
      currency: obligation.currency,
      dueDate: obligation.dueDate.toISOString(),
      status: obligation.status,
      fulfilledAt: obligation.fulfilledAt?.toISOString() ?? null,
      confirmedAmount: toMoney(confirmedAmount),
      outstandingAmount: toMoney(outstandingAmount),
    };
  });

  return {
    circle: { id: circle.id, name: circle.name, currency: circle.currency, status: "ACTIVE" },
    rounds: selectedRounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      recipientDisplayName: round.recipient.displayName,
      dueDate: round.dueDate.toISOString(),
      status: round.status,
    })),
    obligations: obligationResults,
    payments: payments.map(serializePayment),
  };
}
