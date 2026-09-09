import { Prisma } from "@prisma/client";

// Pure, Decimal-exact money helpers for the SUSU contribution ledger --
// no Prisma client calls, no "server-only", no floating-point arithmetic
// anywhere in this file. toMoney/clampToZero are extracted from (not
// duplicated alongside) circle-member-dashboard.service.ts's own private
// copies (7H.2), per the "extract to src/domain once a second real
// consumer needs the identical computation" convention already applied to
// circle-rotation-schedule.ts / circle-activation-review.ts /
// circle-round-selection.ts -- the future contribution recording/
// confirmation services (7J.2+) are that second consumer.

export function toMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function clampToZero(value: Prisma.Decimal): Prisma.Decimal {
  return value.isNegative() ? new Prisma.Decimal(0) : value;
}

/**
 * V1's exact-amount rule (7J audit section 3, approved 7J.1): a confirmed
 * payment must equal the obligation's frozen expectedAmount exactly -- no
 * partial payments, no overpayment. This is the one comparison the future
 * recordContributionPayment/confirmContributionPayment services must
 * perform, under the circle-row lock, against the obligation record they
 * just read fresh from the database -- never against a client-supplied
 * expectedAmount, which is deliberately never accepted as input (see
 * src/validations/contribution.schema.ts).
 */
export function amountMatchesObligation(
  amount: Prisma.Decimal,
  expectedAmount: Prisma.Decimal,
): boolean {
  return amount.equals(expectedAmount);
}

/**
 * The ledger-derived fulfillment rule already implemented and tested in
 * circle-member-dashboard.service.ts: an obligation is fulfilled once its
 * CONFIRMED-only ledger total reaches its expected amount. Written
 * generically (>=, not ==) so it continues to match that pre-existing
 * call site without behavior drift -- V1's exact-amount rule above means
 * confirmedAmount will in practice only ever be exactly 0 or exactly
 * expectedAmount, but this helper does not itself assume that.
 *
 * ContributionObligation.status is never a valid input here or anywhere
 * else in this codebase (7H/7J audit): no writer sets it, so fulfillment
 * must always be computed live from the ContributionPayment ledger, never
 * read off the obligation row.
 */
export function isObligationFulfilled(
  confirmedAmount: Prisma.Decimal,
  expectedAmount: Prisma.Decimal,
): boolean {
  return confirmedAmount.greaterThanOrEqualTo(expectedAmount);
}
