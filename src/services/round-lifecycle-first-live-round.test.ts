import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertFreshStartPrecondition,
  RoundLifecycleIntegrityError,
} from "@/src/services/round-lifecycle.service";
import type { LifecycleRoundRecord } from "@/src/repositories/round-lifecycle.repository";

// Pure, DI-free unit tests for 9F's generalized fresh-start precondition --
// the same class of direct, executable evidence 9E used for its own
// K-bounds/reconstruction-shape checks, since activateFirstRound itself
// needs a real database (unavailable in this environment -- see
// round-lifecycle-first-live-round-structure.test.ts for the structural/
// source evidence covering activateFirstRound's own transaction shape,
// reuse, and target derivation).

const now = new Date("2026-01-01T00:00:00.000Z");

function historical(roundNumber: number): LifecycleRoundRecord {
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
  };
}

function live(roundNumber: number, overrides: Partial<LifecycleRoundRecord> = {}): LifecycleRoundRecord {
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

// -------------------------------------------------------------------
// NEW circle (target = 1): must reduce to the original "every round
// UPCOMING" rule, byte-identical behavior.
// -------------------------------------------------------------------

test("NEW: every round UPCOMING/NIA_MANAGED passes for target=1", () => {
  assert.doesNotThrow(() => assertFreshStartPrecondition([live(1), live(2), live(3)], 1));
});

test("NEW: a round already CLOSED before any activation exists is rejected for target=1", () => {
  assert.throws(() => assertFreshStartPrecondition([historical(1), live(2)], 1), RoundLifecycleIntegrityError);
});

// -------------------------------------------------------------------
// IMPORTED circle (target = K+1)
// -------------------------------------------------------------------

test("IMPORTED K=1/N=2: round 1 CLOSED+IMPORTED_DECLARATION, round 2 UPCOMING+NIA_MANAGED passes for target=2", () => {
  assert.doesNotThrow(() => assertFreshStartPrecondition([historical(1), live(2)], 2));
});

test("IMPORTED K=N-1: every round but the last historical passes for target=N", () => {
  assert.doesNotThrow(() => assertFreshStartPrecondition([historical(1), historical(2), historical(3), live(4)], 4));
});

// -------------------------------------------------------------------
// MALFORMED HISTORY -- rejected, never repaired
// -------------------------------------------------------------------

test("rejects a missing historical CLOSED round (round before target is UPCOMING instead)", () => {
  assert.throws(
    () => assertFreshStartPrecondition([live(1), live(2)], 2),
    RoundLifecycleIntegrityError,
  );
});

test("rejects the wrong closureBasis on a historical round (CLOSED but NIA_MANAGED)", () => {
  const wrongBasis: LifecycleRoundRecord = { ...historical(1), closureBasis: "NIA_MANAGED" };
  assert.throws(
    () => assertFreshStartPrecondition([wrongBasis, live(2)], 2),
    RoundLifecycleIntegrityError,
  );
});

test("rejects an unexpected ACTIVE round anywhere in the prefix or target position", () => {
  const unexpectedActive: LifecycleRoundRecord = { ...historical(1), status: "ACTIVE", closedAt: null, closedById: null };
  assert.throws(
    () => assertFreshStartPrecondition([unexpectedActive, live(2)], 2),
    RoundLifecycleIntegrityError,
  );
});

test("rejects a malformed future suffix (a round after the target already CLOSED)", () => {
  assert.throws(
    () => assertFreshStartPrecondition([historical(1), live(2), historical(3)], 2),
    RoundLifecycleIntegrityError,
  );
});

test("rejects the target round itself if it is not UPCOMING", () => {
  assert.throws(
    () => assertFreshStartPrecondition([historical(1), historical(2)], 2),
    RoundLifecycleIntegrityError,
  );
});

test("rejects the target round if its closureBasis is already IMPORTED_DECLARATION (a target must be genuinely NIA-managed)", () => {
  const wrongTarget: LifecycleRoundRecord = { ...live(2), closureBasis: "IMPORTED_DECLARATION" };
  assert.throws(
    () => assertFreshStartPrecondition([historical(1), wrongTarget], 2),
    RoundLifecycleIntegrityError,
  );
});

// -------------------------------------------------------------------
// structural evidence: the write path never accepts a client-controlled
// target, and the historical prefix is only ever read, never mutated
// -------------------------------------------------------------------

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const roundLifecycleService = stripComments(readFileSync(new URL("./round-lifecycle.service.ts", import.meta.url), "utf8"));
const activateFirstRoundAction = readFileSync(new URL("../actions/activate-first-round.ts", import.meta.url), "utf8");

test("activateFirstRound's input has no roundNumber/K/originKind field -- the target is derived, never accepted", () => {
  const signatureMatch = roundLifecycleService.match(/export async function activateFirstRound\(params: \{([\s\S]*?)\}\): Promise<ActivateFirstRoundResult>/);
  assert.ok(signatureMatch, "expected to find activateFirstRound's input type");
  const fieldNames = [...signatureMatch![1].matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((match) => match[1]);
  assert.deepEqual(fieldNames.sort(), ["circleId", "ownerId"]);
});

test("the Server Action submits only circleId -- no round number, K, or origin field", () => {
  assert.doesNotMatch(activateFirstRoundAction, /formData\.get\("roundNumber"\)/);
  assert.doesNotMatch(activateFirstRoundAction, /formData\.get\("historicalCompletedRoundCount"\)/);
  assert.doesNotMatch(activateFirstRoundAction, /formData\.get\("originKind"\)/);
  assert.match(activateFirstRoundAction, /circleId = String\(formData\.get\("circleId"\) \?\? ""\)/);
});

test("firstLiveRoundNumber is derived from the freshly re-read, lock-held circle row on both the unlocked pre-check and the locked authoritative path", () => {
  const matches = [...roundLifecycleService.matchAll(/firstLiveRoundNumber\(([a-zA-Z]+)\.originKind, \1\.historicalCompletedRoundCount\)/g)];
  assert.equal(matches.length, 2, "expected exactly two derivations: the unlocked pre-check and the locked re-check");
});

test("activateFirstRound never calls a round-lifecycle writer for any round other than the single derived target", () => {
  // Exactly one activateLifecycleRound call in the fresh-write path, and
  // it is always keyed by *ThisFunction's own* freshTargetRound(.id), never
  // a second round id computed independently.
  const body = roundLifecycleService.slice(
    roundLifecycleService.indexOf("export async function activateFirstRound"),
    roundLifecycleService.indexOf("export async function activateFirstRound") + roundLifecycleService.slice(roundLifecycleService.indexOf("export async function activateFirstRound")).indexOf("\nexport async function advanceRound"),
  );
  const activateCalls = [...body.matchAll(/activateLifecycleRound\(transaction, \{/g)];
  assert.equal(activateCalls.length, 1, "expected exactly one activateLifecycleRound call");
  assert.match(body, /roundId: freshTargetRound\.id/);
});

test("the imported-prefix coherence check reuses circle.service.ts's own canonical assertImportedReconstructionIntegrity -- never a second audit algorithm", () => {
  assert.match(roundLifecycleService, /import \{ assertImportedReconstructionIntegrity, CircleActivationIntegrityError \} from "@\/src\/services\/circle\.service";/);
  assert.match(roundLifecycleService, /assertImportedReconstructionIntegrity\(circle, rounds, obligations, payouts\)/);
  // Only ever invoked when originKind is IMPORTED -- the common NEW path
  // pays no extra query cost.
  assert.match(roundLifecycleService, /if \(circle\.originKind === "IMPORTED"\) \{\s*await assertImportedPrefixCoherent/);
  assert.match(roundLifecycleService, /if \(freshCircle\.originKind === "IMPORTED"\) \{\s*await assertImportedPrefixCoherent/);
});

test("assertImportedPrefixCoherent reuses circle.repository.ts's own canonical whole-circle reads -- never a second query shape", () => {
  assert.match(
    roundLifecycleService,
    /import \{\s*findCircleActivationObligations,\s*findCircleActivationPayouts,\s*findCircleActivationRounds,\s*\} from "@\/src\/repositories\/circle\.repository";/,
  );
});

test("this module never writes SavingsCircle, ContributionObligation, ContributionPayment, or Payout -- only PayoutRound.status/provenance, unchanged since 7K.13", () => {
  for (const forbidden of [
    ".savingsCircle.update",
    ".contributionObligation.update",
    ".contributionObligation.create",
    ".contributionPayment.create",
    ".payout.create",
    ".payout.update",
  ]) {
    assert.ok(!roundLifecycleService.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no member-session identity system is referenced anywhere in this module", () => {
  for (const forbidden of ["requireCircleMember", "nia_member_session", "CircleMemberSession"]) {
    assert.ok(!roundLifecycleService.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
