import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Prisma } from "@prisma/client";

import {
  assertImportedActivationKBounds,
  assertImportedReconstructionIntegrity,
  CircleActivationIntegrityError,
  CircleActivationEligibilityError,
} from "@/src/services/circle.service";
import type {
  CircleActivationObligationRecord,
  CircleActivationPayoutRecord,
  CircleActivationRoundRecord,
} from "@/src/repositories/circle.repository";

// Pure, DI-free unit tests for the two sub-checks 9E's activateImportedCircle
// depends on -- both extracted and exported specifically so this ticket's
// own high-risk domain logic (K/N boundaries, historical-shape coherence)
// has real, directly-executed test evidence, not only structural/regex
// evidence, despite activateImportedCircle itself needing a real database
// (unreachable in this environment -- 9E ticket §23). See
// circle-imported-activation-structure.test.ts for the structural/source
// evidence covering activateImportedCircle's own transaction shape, reuse,
// and routing.

const d = (value: string) => new Prisma.Decimal(value);
const now = new Date("2026-01-01T00:00:00.000Z");

// -------------------------------------------------------------------
// assertImportedActivationKBounds
// -------------------------------------------------------------------

test("K=1 of N=2 is accepted (the smallest legitimate import)", () => {
  assert.doesNotThrow(() => assertImportedActivationKBounds(1, 2));
});

test("K=N-1 is accepted (the largest legitimate import -- exactly one live round remains)", () => {
  assert.doesNotThrow(() => assertImportedActivationKBounds(4, 5));
});

test("K=0 is rejected -- zero history is never a valid import (freeze §2's own zero-history edge)", () => {
  assert.throws(() => assertImportedActivationKBounds(0, 5), CircleActivationEligibilityError);
});

test("K=N is rejected -- V1 must not import an already-finished circle", () => {
  assert.throws(() => assertImportedActivationKBounds(5, 5), CircleActivationEligibilityError);
});

test("K>N is rejected", () => {
  assert.throws(() => assertImportedActivationKBounds(9, 5), CircleActivationEligibilityError);
});

test("a negative K is rejected", () => {
  assert.throws(() => assertImportedActivationKBounds(-1, 5), CircleActivationEligibilityError);
});

test("a non-integer K is rejected", () => {
  assert.throws(() => assertImportedActivationKBounds(1.5, 5), CircleActivationEligibilityError);
});

// -------------------------------------------------------------------
// assertImportedReconstructionIntegrity -- fixture builders
// -------------------------------------------------------------------

function historicalRound(roundNumber: number, overrides: Partial<CircleActivationRoundRecord> = {}): CircleActivationRoundRecord {
  return {
    id: `round-${roundNumber}`,
    circleId: "circle-1",
    roundNumber,
    recipientId: `member-${roundNumber}`,
    dueDate: now,
    status: "CLOSED",
    closureBasis: "IMPORTED_DECLARATION",
    activatedAt: now,
    activatedById: "owner-1",
    closedAt: now,
    closedById: "owner-1",
    ...overrides,
  };
}

function liveRound(roundNumber: number, overrides: Partial<CircleActivationRoundRecord> = {}): CircleActivationRoundRecord {
  return {
    id: `round-${roundNumber}`,
    circleId: "circle-1",
    roundNumber,
    recipientId: `member-${roundNumber}`,
    dueDate: now,
    status: "UPCOMING",
    closureBasis: "NIA_MANAGED",
    activatedAt: null,
    activatedById: null,
    closedAt: null,
    closedById: null,
    ...overrides,
  };
}

function historicalObligation(roundId: string, memberId: string, overrides: Partial<CircleActivationObligationRecord> = {}): CircleActivationObligationRecord {
  return {
    circleId: "circle-1",
    roundId,
    memberId,
    expectedAmount: d("10.00"),
    currency: "USD",
    dueDate: now,
    status: "FULFILLED",
    fulfillmentBasis: "IMPORTED_DECLARATION",
    fulfilledAt: now,
    ...overrides,
  };
}

function liveObligation(roundId: string, memberId: string, overrides: Partial<CircleActivationObligationRecord> = {}): CircleActivationObligationRecord {
  return {
    circleId: "circle-1",
    roundId,
    memberId,
    expectedAmount: d("10.00"),
    currency: "USD",
    dueDate: now,
    status: "OPEN",
    fulfillmentBasis: "NIA_CONFIRMED_LEDGER",
    fulfilledAt: null,
    ...overrides,
  };
}

function historicalPayout(roundId: string, overrides: Partial<CircleActivationPayoutRecord> = {}): CircleActivationPayoutRecord {
  return {
    id: `payout-${roundId}`,
    circleId: "circle-1",
    roundId,
    amount: d("20.00"),
    currency: "USD",
    status: "CONFIRMED",
    confirmationBasis: "IMPORTED_DECLARATION",
    clientOperationId: `imported-activation:${roundId}`,
    recordedAt: now,
    recordedById: "owner-1",
    confirmedAt: now,
    confirmedByMemberId: null,
    disputedAt: null,
    disputedByMemberId: null,
    disputeReason: null,
    ...overrides,
  };
}

// A coherent K=1, N=2 shape: round 1 historical (closed, one obligation
// per member, one payout), round 2 live (upcoming, open obligations, no
// payout) -- the minimal legitimate reconstructed circle.
function coherentFixture() {
  const rounds = [historicalRound(1), liveRound(2)];
  const obligations = [
    historicalObligation("round-1", "member-1"),
    historicalObligation("round-1", "member-2"),
    liveObligation("round-2", "member-1"),
    liveObligation("round-2", "member-2"),
  ];
  const payouts = [historicalPayout("round-1")];
  return { rounds, obligations, payouts };
}

// -------------------------------------------------------------------
// assertImportedReconstructionIntegrity -- accepted shapes
// -------------------------------------------------------------------

test("a coherent K=1/N=2 reconstruction passes", () => {
  const { rounds, obligations, payouts } = coherentFixture();
  assert.doesNotThrow(() =>
    assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
  );
});

test("K=N-1: every round but the last historical, exactly one live round, passes", () => {
  const rounds = [historicalRound(1), historicalRound(2), historicalRound(3), liveRound(4)];
  const obligations = [1, 2, 3].flatMap((r) => ["member-a", "member-b"].map((m) => historicalObligation(`round-${r}`, m)))
    .concat(["member-a", "member-b"].map((m) => liveObligation("round-4", m)));
  const payouts = [1, 2, 3].map((r) => historicalPayout(`round-${r}`));
  assert.doesNotThrow(() =>
    assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 3 }, rounds, obligations, payouts),
  );
});

// -------------------------------------------------------------------
// assertImportedReconstructionIntegrity -- rejected shapes (no
// fabricated financial confirmation may ever pass this check)
// -------------------------------------------------------------------

test("rejects a historical round that is not CLOSED", () => {
  const { obligations, payouts } = coherentFixture();
  const rounds = [historicalRound(1, { status: "UPCOMING" }), liveRound(2)];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical round whose closureBasis is NIA_MANAGED (must be distinguishable from a normal closure)", () => {
  const { obligations, payouts } = coherentFixture();
  const rounds = [historicalRound(1, { closureBasis: "NIA_MANAGED" }), liveRound(2)];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a live round that is not UPCOMING", () => {
  const { obligations, payouts } = coherentFixture();
  const rounds = [historicalRound(1), liveRound(2, { status: "CLOSED" })];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical obligation that is not FULFILLED", () => {
  const { rounds, payouts } = coherentFixture();
  const obligations = [
    historicalObligation("round-1", "member-1", { status: "OPEN" }),
    historicalObligation("round-1", "member-2"),
    liveObligation("round-2", "member-1"),
    liveObligation("round-2", "member-2"),
  ];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical obligation whose fulfillmentBasis is NIA_CONFIRMED_LEDGER (must never look like a real confirmed payment)", () => {
  const { rounds, payouts } = coherentFixture();
  const obligations = [
    historicalObligation("round-1", "member-1", { fulfillmentBasis: "NIA_CONFIRMED_LEDGER" }),
    historicalObligation("round-1", "member-2"),
    liveObligation("round-2", "member-1"),
    liveObligation("round-2", "member-2"),
  ];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical obligation with no fulfilledAt", () => {
  const { rounds, payouts } = coherentFixture();
  const obligations = [
    historicalObligation("round-1", "member-1", { fulfilledAt: null }),
    historicalObligation("round-1", "member-2"),
    liveObligation("round-2", "member-1"),
    liveObligation("round-2", "member-2"),
  ];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a live obligation that is already FULFILLED -- no future round may appear settled", () => {
  const { rounds, payouts } = coherentFixture();
  const obligations = [
    historicalObligation("round-1", "member-1"),
    historicalObligation("round-1", "member-2"),
    liveObligation("round-2", "member-1", { status: "FULFILLED", fulfillmentBasis: "IMPORTED_DECLARATION", fulfilledAt: now }),
    liveObligation("round-2", "member-2"),
  ];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical round with no payout at all", () => {
  const { rounds, obligations } = coherentFixture();
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, []),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical round's payout if it is not CONFIRMED", () => {
  const { rounds, obligations } = coherentFixture();
  const payouts = [historicalPayout("round-1", { status: "RECORDED" })];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical payout whose confirmationBasis is MEMBER_CONFIRMED -- must never look like a real recipient confirmation", () => {
  const { rounds, obligations } = coherentFixture();
  const payouts = [historicalPayout("round-1", { confirmationBasis: "MEMBER_CONFIRMED" })];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical payout that fabricates a member confirmer (confirmedByMemberId must always be null)", () => {
  const { rounds, obligations } = coherentFixture();
  const payouts = [historicalPayout("round-1", { confirmedByMemberId: "member-1" })];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a historical payout carrying dispute provenance", () => {
  const { rounds, obligations } = coherentFixture();
  const payouts = [historicalPayout("round-1", { disputedAt: now, disputedByMemberId: "member-1", disputeReason: "reason" })];
  assert.throws(
    () => assertImportedReconstructionIntegrity({ historicalCompletedRoundCount: 1 }, rounds, obligations, payouts),
    CircleActivationIntegrityError,
  );
});

test("rejects a live round that already has a payout row -- no future beneficiary may appear paid", () => {
  const { rounds, obligations, payouts } = coherentFixture();
  assert.throws(
    () => assertImportedReconstructionIntegrity(
      { historicalCompletedRoundCount: 1 },
      rounds,
      obligations,
      [...payouts, historicalPayout("round-2")],
    ),
    CircleActivationIntegrityError,
  );
});

test("rejects two payout rows for the same historical round", () => {
  const { rounds, obligations, payouts } = coherentFixture();
  assert.throws(
    () => assertImportedReconstructionIntegrity(
      { historicalCompletedRoundCount: 1 },
      rounds,
      obligations,
      [...payouts, historicalPayout("round-1")],
    ),
    CircleActivationIntegrityError,
  );
});

// -------------------------------------------------------------------
// no ContributionPayment fabrication -- structural evidence
// -------------------------------------------------------------------

test("assertImportedReconstructionIntegrity never references ContributionPayment -- it has no query of its own and cannot fabricate one", () => {
  const source = readFileSync(new URL("./circle.service.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function assertImportedReconstructionIntegrity");
  const end = source.indexOf("function serializeImportedActivationResult", start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /ContributionPayment|contributionPayment/);
});
