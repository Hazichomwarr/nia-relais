import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import {
  assertRotationSequenceIntegrity,
  assertRoundLifecycleStateIntegrity,
  assessContributionClosureReadiness,
  assessPayoutClosureReadiness,
  RoundLifecycleFinancialIntegrityError,
  RoundLifecycleStateIntegrityError,
  type ContributionClosureObligation,
  type PayoutClosurePayout,
  type RoundLifecycleRoundRecord,
} from "./round-lifecycle";

const d = (value: string) => new Prisma.Decimal(value);

const EXPECTED = { amount: d("100.00"), currency: "USD" };

const now = new Date("2026-01-01T00:00:00.000Z");

function round(overrides: Partial<RoundLifecycleRoundRecord> & { roundNumber: number }): RoundLifecycleRoundRecord {
  return {
    status: "UPCOMING",
    activatedAt: null,
    activatedById: null,
    closedAt: null,
    closedById: null,
    ...overrides,
  };
}

function upcoming(roundNumber: number): RoundLifecycleRoundRecord {
  return round({ roundNumber });
}

function active(roundNumber: number): RoundLifecycleRoundRecord {
  return round({ roundNumber, status: "ACTIVE", activatedAt: now, activatedById: "owner-1" });
}

function closed(roundNumber: number): RoundLifecycleRoundRecord {
  return round({
    roundNumber,
    status: "CLOSED",
    activatedAt: now,
    activatedById: "owner-1",
    closedAt: now,
    closedById: "owner-1",
  });
}

// -------------------------------------------------------------------
// assertRotationSequenceIntegrity
// -------------------------------------------------------------------

test("accepts an exact 1..N sequence of at least two rounds", () => {
  assert.doesNotThrow(() => assertRotationSequenceIntegrity([{ roundNumber: 1 }, { roundNumber: 2 }, { roundNumber: 3 }]));
});

test("rejects fewer than two rounds", () => {
  assert.throws(() => assertRotationSequenceIntegrity([{ roundNumber: 1 }]), RoundLifecycleStateIntegrityError);
});

test("rejects a gap in round numbers", () => {
  assert.throws(
    () => assertRotationSequenceIntegrity([{ roundNumber: 1 }, { roundNumber: 3 }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("is order-independent (sorts before checking)", () => {
  assert.doesNotThrow(() => assertRotationSequenceIntegrity([{ roundNumber: 3 }, { roundNumber: 1 }, { roundNumber: 2 }]));
});

// -------------------------------------------------------------------
// assertRoundLifecycleStateIntegrity -- the three legitimate shapes
// -------------------------------------------------------------------

test("A. pre-start: every round UPCOMING is valid", () => {
  assert.doesNotThrow(() => assertRoundLifecycleStateIntegrity([upcoming(1), upcoming(2), upcoming(3)]));
});

test("B. in progress: CLOSED prefix, one ACTIVE, UPCOMING suffix is valid", () => {
  assert.doesNotThrow(() =>
    assertRoundLifecycleStateIntegrity([closed(1), closed(2), active(3), upcoming(4), upcoming(5)]),
  );
});

test("B (minimal): exactly one ACTIVE round with no CLOSED/UPCOMING neighbors is valid", () => {
  assert.doesNotThrow(() => assertRoundLifecycleStateIntegrity([active(1), upcoming(2)]));
});

test("C. final pre-completion: every round CLOSED is valid", () => {
  assert.doesNotThrow(() => assertRoundLifecycleStateIntegrity([closed(1), closed(2), closed(3)]));
});

test("order in the input array does not matter -- sorted internally by roundNumber", () => {
  assert.doesNotThrow(() =>
    assertRoundLifecycleStateIntegrity([upcoming(4), closed(1), active(3), closed(2), upcoming(5)]),
  );
});

// -------------------------------------------------------------------
// assertRoundLifecycleStateIntegrity -- rejected shapes
// -------------------------------------------------------------------

test("rejects more than one ACTIVE round", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([closed(1), active(2), active(3)]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a CLOSED round appearing after an ACTIVE round", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([active(1), closed(2)]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a CLOSED round appearing after an UPCOMING round", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([upcoming(1), closed(2)]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects an ACTIVE round with an earlier UPCOMING round (out-of-sequence activation)", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([upcoming(1), active(2)]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a mid-rotation mix of CLOSED and UPCOMING with zero ACTIVE rounds", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([closed(1), closed(2), upcoming(3), upcoming(4)]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a CLOSED round missing closedAt", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...closed(1), closedAt: null }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a CLOSED round missing closedById", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...closed(1), closedById: null }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a CLOSED round missing activatedAt", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...closed(1), activatedAt: null }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects a CLOSED round missing activatedById", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...closed(1), activatedById: null }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects an ACTIVE round missing activatedAt", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...active(1), activatedAt: null }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects an ACTIVE round missing activatedById", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...active(1), activatedById: null }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects an ACTIVE round carrying unexpected closure provenance", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...active(1), closedAt: now, closedById: "owner-1" }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects an UPCOMING round carrying unexpected activation provenance", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...upcoming(1), activatedAt: now, activatedById: "owner-1" }]),
    RoundLifecycleStateIntegrityError,
  );
});

test("rejects an UPCOMING round carrying unexpected closure provenance", () => {
  assert.throws(
    () => assertRoundLifecycleStateIntegrity([{ ...upcoming(1), closedAt: now, closedById: "owner-1" }]),
    RoundLifecycleStateIntegrityError,
  );
});

// -------------------------------------------------------------------
// assessContributionClosureReadiness (7K.15 extraction)
// -------------------------------------------------------------------

function fulfilledObligation(confirmedAmount = d("100.00")): ContributionClosureObligation {
  return { expectedAmount: d("100.00"), status: "FULFILLED", fulfilledAt: now, confirmedAmount };
}

function openObligation(confirmedAmount = d("0.00")): ContributionClosureObligation {
  return { expectedAmount: d("100.00"), status: "OPEN", fulfilledAt: null, confirmedAmount };
}

test("READY when every obligation is fulfilled and ledger-coherent", () => {
  assert.equal(
    assessContributionClosureReadiness([fulfilledObligation(), fulfilledObligation()]),
    "READY",
  );
});

test("INCOMPLETE when at least one obligation is genuinely OPEN with no confirmed ledger support", () => {
  assert.equal(
    assessContributionClosureReadiness([fulfilledObligation(), openObligation()]),
    "INCOMPLETE",
  );
});

test("rejects an empty obligation set as an integrity failure, not as ordinary incompleteness", () => {
  assert.throws(() => assessContributionClosureReadiness([]), RoundLifecycleFinancialIntegrityError);
});

test("rejects FULFILLED status with no coherent confirmed ledger support (corruption, not incompleteness)", () => {
  assert.throws(
    () => assessContributionClosureReadiness([fulfilledObligation(d("0.00"))]),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects OPEN status despite a coherent confirmed payment already covering it (corruption, not readiness)", () => {
  assert.throws(
    () => assessContributionClosureReadiness([openObligation(d("100.00"))]),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a FULFILLED obligation missing its fulfilledAt timestamp", () => {
  assert.throws(
    () => assessContributionClosureReadiness([{ ...fulfilledObligation(), fulfilledAt: null }]),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects an OPEN obligation that carries a fulfilledAt timestamp it should not have", () => {
  assert.throws(
    () => assessContributionClosureReadiness([{ ...openObligation(), fulfilledAt: now }]),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("a rejected historical payment attempt alongside a coherent confirmed one is still READY (only CONFIRMED sums are ever passed in)", () => {
  // The caller (repository-level sum) already excludes REJECTED attempts
  // from confirmedAmount -- this function only ever sees the final
  // confirmed total, so a fulfilled obligation whose confirmedAmount
  // reflects "one rejected + one confirmed" is indistinguishable here from
  // "one confirmed," and correctly reads READY.
  assert.equal(assessContributionClosureReadiness([fulfilledObligation(d("100.00"))]), "READY");
});

// -------------------------------------------------------------------
// assessPayoutClosureReadiness (7K.15 extraction)
// -------------------------------------------------------------------

const RECIPIENT_ID = "member-1";

function confirmedPayout(overrides: Partial<PayoutClosurePayout> = {}): PayoutClosurePayout {
  return {
    status: "CONFIRMED",
    currency: "USD",
    amount: d("100.00"),
    recordedById: "owner-1",
    confirmedAt: now,
    confirmedByMemberId: RECIPIENT_ID,
    disputedAt: null,
    disputedByMemberId: null,
    disputeReason: null,
    ...overrides,
  };
}

test("MISSING when no payout has been recorded", () => {
  assert.equal(assessPayoutClosureReadiness(null, RECIPIENT_ID, EXPECTED), "MISSING");
});

test("NOT_CONFIRMED for a RECORDED-only payout", () => {
  const payout: PayoutClosurePayout = {
    status: "RECORDED",
    currency: "USD",
    amount: d("100.00"),
    recordedById: "owner-1",
    confirmedAt: null,
    confirmedByMemberId: null,
    disputedAt: null,
    disputedByMemberId: null,
    disputeReason: null,
  };
  assert.equal(assessPayoutClosureReadiness(payout, RECIPIENT_ID, EXPECTED), "NOT_CONFIRMED");
});

test("DISPUTED is a valid terminal classification, never treated as corruption", () => {
  const payout: PayoutClosurePayout = {
    status: "DISPUTED",
    currency: "USD",
    amount: d("100.00"),
    recordedById: "owner-1",
    confirmedAt: null,
    confirmedByMemberId: null,
    disputedAt: now,
    disputedByMemberId: RECIPIENT_ID,
    disputeReason: "wrong amount",
  };
  assert.equal(assessPayoutClosureReadiness(payout, RECIPIENT_ID, EXPECTED), "DISPUTED");
});

test("READY for a coherent CONFIRMED payout", () => {
  assert.equal(assessPayoutClosureReadiness(confirmedPayout(), RECIPIENT_ID, EXPECTED), "READY");
});

test("rejects an amount drift on a CONFIRMED payout", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ amount: d("99.99") }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a currency drift on a CONFIRMED payout", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ currency: "EUR" }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a CONFIRMED payout whose confirmedByMemberId does not match the round's recipient", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ confirmedByMemberId: "someone-else" }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a CONFIRMED payout missing its confirmedAt timestamp", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ confirmedAt: null }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a CONFIRMED payout that also carries dispute provenance", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ disputedAt: now }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a CONFIRMED payout with an empty recordedById", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ recordedById: "" }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});

test("rejects a payout with an unrecognized status", () => {
  assert.throws(
    () => assessPayoutClosureReadiness(confirmedPayout({ status: "SOMETHING_ELSE" }), RECIPIENT_ID, EXPECTED),
    RoundLifecycleFinancialIntegrityError,
  );
});
