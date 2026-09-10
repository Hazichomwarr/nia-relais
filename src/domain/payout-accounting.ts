import { Prisma } from "@prisma/client";

import { amountMatchesObligation } from "@/src/domain/contribution-accounting";

// Pure, Decimal-exact money helpers for the SUSU payout ledger -- no
// Prisma client calls, no "server-only", no floating-point arithmetic
// anywhere in this file. Mirrors contribution-accounting.ts's own
// posture exactly; the one addition this module needs beyond that file
// is computeExpectedPayoutAmount, because a payout's authoritative
// amount is not a single frozen field (like ContributionObligation
// .expectedAmount) but a SUM over a round's own frozen obligations
// (7K audit section 5, frozen 7K.1 "V1 Signed-Off Contract" item 1).
//
// This is the first domain module in this codebase whose core function
// has a genuine partial/failure case -- every prior domain helper
// (contribution-accounting.ts, circle-rotation-schedule.ts,
// circle-round-selection.ts, circle-activation-review.ts) is a total
// function over its entire input domain and none of them throws.
// computeExpectedPayoutAmount cannot make that same claim: an empty or
// currency-inconsistent obligation set is a genuine integrity failure a
// caller must be told about, not a case this function can silently paper
// over. PayoutAccountingIntegrityError is defined here, at the domain
// layer, rather than deferred to the future recordPayout service,
// because the failure is intrinsic to the accounting rule itself, not to
// any particular caller's context -- any future consumer of this
// function (recordPayout, an owner read model, a future audit script)
// must handle the identical failure the identical way.

export class PayoutAccountingIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutAccountingIntegrityError";
  }
}

export type PayoutRoundObligationRecord = {
  readonly expectedAmount: Prisma.Decimal;
  readonly currency: string;
};

export type ExpectedPayoutAmount = {
  readonly amount: Prisma.Decimal;
  readonly currency: string;
};

/**
 * The authoritative V1 payout amount for one round (7K audit section 5,
 * frozen 7K.1): the exact sum of every persisted
 * ContributionObligation.expectedAmount belonging to that round --
 * never the live CircleMember count, never payoutOrder, never
 * circle.contributionAmount x live membership, never PayoutRound.status,
 * never a due date. The caller is responsible for fetching every
 * obligation row for the round (this function has no database access of
 * its own and trusts the caller's query scoping completely); this
 * function only performs the pure arithmetic and the two integrity
 * checks the 7K.1 sign-off requires.
 *
 * Requires at least one obligation -- a round with zero obligations is
 * an integrity failure (activation always creates one obligation per
 * member per round; a round with none means either a pre-activation
 * round was queried by mistake, or activation-time data has been
 * corrupted), never silently treated as a zero-amount payout.
 *
 * Requires every obligation to agree on currency -- activation always
 * stamps every obligation with the circle's own frozen currency
 * (verified independently by assertActivatedRotationIntegrity in
 * circle.service.ts), so a real disagreement here can only mean
 * corrupted history. This function refuses to guess which currency is
 * "right" and refuses to sum across currencies -- it rejects outright.
 */
export function computeExpectedPayoutAmount(
  obligations: readonly PayoutRoundObligationRecord[],
): ExpectedPayoutAmount {
  if (obligations.length === 0) {
    throw new PayoutAccountingIntegrityError(
      "No contribution obligations exist for this round; the expected payout amount cannot be determined.",
    );
  }

  const currency = obligations[0].currency;
  if (obligations.some((obligation) => obligation.currency !== currency)) {
    throw new PayoutAccountingIntegrityError(
      "This round's contribution obligations do not agree on a single currency.",
    );
  }

  const amount = obligations.reduce(
    (total, obligation) => total.plus(obligation.expectedAmount),
    new Prisma.Decimal(0),
  );

  return { amount, currency };
}

/**
 * Decimal-exact equality only, exactly the rule 7K.1's sign-off item 1
 * freezes for payouts too: a proposed payout amount is valid only if it
 * equals the authoritative computeExpectedPayoutAmount result exactly --
 * no tolerance, no rounding workaround, no partial payout, no
 * overpayment, no Number conversion anywhere. Reused unchanged from
 * contribution-accounting.ts (aliased, not reimplemented) rather than
 * duplicated: the underlying arithmetic rule is identical for
 * contributions and payouts, so a second copy would be a second place
 * for the two to silently drift apart.
 */
export const amountMatchesExpectedPayout = amountMatchesObligation;
