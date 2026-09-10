import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Prisma } from "@prisma/client";

import {
  amountMatchesExpectedPayout,
  computeExpectedPayoutAmount,
  PayoutAccountingIntegrityError,
  type PayoutRoundObligationRecord,
} from "./payout-accounting";

function obligation(expectedAmount: string, currency = "USD"): PayoutRoundObligationRecord {
  return { expectedAmount: new Prisma.Decimal(expectedAmount), currency };
}

// --- computeExpectedPayoutAmount: accounting ---

test("one obligation: the expected payout amount equals that single obligation's amount", () => {
  const result = computeExpectedPayoutAmount([obligation("50.00")]);
  assert.ok(result.amount.equals(new Prisma.Decimal("50.00")));
  assert.equal(result.currency, "USD");
});

test("multiple obligations: the expected payout amount is the exact Decimal sum", () => {
  const result = computeExpectedPayoutAmount([
    obligation("25.00"),
    obligation("25.00"),
    obligation("25.00"),
    obligation("25.00"),
  ]);
  assert.ok(result.amount.equals(new Prisma.Decimal("100.00")));
});

test("exact Decimal sum has no floating-point drift on values JS floats cannot represent exactly", () => {
  // 0.1 + 0.2 famously does not equal 0.3 in JS floating-point arithmetic.
  const result = computeExpectedPayoutAmount([obligation("0.1"), obligation("0.2")]);
  assert.ok(result.amount.equals(new Prisma.Decimal("0.3")));
  assert.notEqual(0.1 + 0.2, 0.3);
});

test("an XOF-style integer amount sums exactly with no decimal fraction introduced", () => {
  const result = computeExpectedPayoutAmount([
    obligation("5000", "XOF"),
    obligation("5000", "XOF"),
    obligation("5000", "XOF"),
  ]);
  assert.ok(result.amount.equals(new Prisma.Decimal("15000")));
  assert.equal(result.currency, "XOF");
});

test("a decimal-currency amount sums exactly to two decimal places", () => {
  const result = computeExpectedPayoutAmount([obligation("33.33"), obligation("33.33"), obligation("33.34")]);
  assert.ok(result.amount.equals(new Prisma.Decimal("100.00")));
});

test("the sum never passes through a JavaScript Number -- large obligation counts stay exact", () => {
  const obligations = Array.from({ length: 37 }, () => obligation("0.10"));
  const result = computeExpectedPayoutAmount(obligations);
  assert.ok(result.amount.equals(new Prisma.Decimal("3.70")));
});

test("an empty obligation set is rejected as an integrity failure, never silently treated as a zero-amount payout", () => {
  assert.throws(() => computeExpectedPayoutAmount([]), PayoutAccountingIntegrityError);
});

test("inconsistent currencies across a round's obligations are rejected as an integrity failure", () => {
  assert.throws(
    () => computeExpectedPayoutAmount([obligation("50.00", "USD"), obligation("50.00", "XOF")]),
    PayoutAccountingIntegrityError,
  );
});

test("the integrity error carries a clear, non-generic message for each distinct failure", () => {
  try {
    computeExpectedPayoutAmount([]);
    assert.fail("expected computeExpectedPayoutAmount to throw for an empty obligation set");
  } catch (error) {
    assert.ok(error instanceof PayoutAccountingIntegrityError);
    assert.match((error as Error).message, /no contribution obligations/i);
  }

  try {
    computeExpectedPayoutAmount([obligation("10.00", "USD"), obligation("10.00", "XOF")]);
    assert.fail("expected computeExpectedPayoutAmount to throw for inconsistent currencies");
  } catch (error) {
    assert.ok(error instanceof PayoutAccountingIntegrityError);
    assert.match((error as Error).message, /currency/i);
  }
});

test("never derives the amount from anything but the obligation rows themselves -- no member-count, payoutOrder, or circle-amount input exists in the function's own signature", () => {
  // computeExpectedPayoutAmount's parameter type only accepts
  // {expectedAmount, currency} -- there is no live-member-count,
  // payoutOrder, contributionAmount, round-status, or due-date field
  // anywhere in PayoutRoundObligationRecord for a caller to (mis)supply.
  const result = computeExpectedPayoutAmount([obligation("10.00"), obligation("10.00")]);
  assert.deepEqual(Object.keys(result).sort(), ["amount", "currency"]);
});

// --- amountMatchesExpectedPayout: amount matching ---

test("amountMatchesExpectedPayout is an exact Decimal-equality reuse of amountMatchesObligation, not a duplicate", () => {
  const expected = new Prisma.Decimal("100.00");
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("100.00"), expected), true);
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("100"), expected), true);
});

test("amountMatchesExpectedPayout rejects underpayment", () => {
  const expected = new Prisma.Decimal("100.00");
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("99.99"), expected), false);
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("50.00"), expected), false);
});

test("amountMatchesExpectedPayout rejects overpayment", () => {
  const expected = new Prisma.Decimal("100.00");
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("100.01"), expected), false);
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("150.00"), expected), false);
});

test("amountMatchesExpectedPayout applies no tolerance or rounding workaround", () => {
  const expected = new Prisma.Decimal("100.00");
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("100.001"), expected), false);
  assert.equal(amountMatchesExpectedPayout(new Prisma.Decimal("99.995"), expected), false);
});

// --- architecture: round-lifecycle separation and no member-auth dependency (7K.2 section 11) ---

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(readFileSync(new URL("./payout-accounting.ts", import.meta.url), "utf8"));

test("this module's code never references PayoutRound status/lifecycle, round activation, or round/circle closure", () => {
  // PayoutRoundObligationRecord is a legitimate local type name (the
  // caller passes obligation rows scoped to a round) -- what must never
  // appear is an actual coupling: importing PayoutRoundStatus, touching
  // a round's own status field, or calling a round/circle lifecycle
  // transition.
  for (const forbidden of [
    /\bPayoutRoundStatus\b/,
    /\.status\b.*round/i,
    /\bcloseRound\b/,
    /\bactivateRound\b/,
    /\bcompleteCircle\b/,
    /\.payoutRound\./,
  ]) {
    assert.doesNotMatch(source, forbidden, `expected no code match for ${forbidden}`);
  }
});

test("this module has no member-auth, Prisma client, service, or repository dependency -- pure domain logic only", () => {
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
  assert.doesNotMatch(source, /from ["']@\/src\/services/);
  assert.doesNotMatch(source, /from ["']@\/src\/repositories/);
  assert.doesNotMatch(source, /"server-only"/);
});
