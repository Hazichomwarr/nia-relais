import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRotationSequenceIntegrity,
  assertRoundLifecycleStateIntegrity,
  RoundLifecycleStateIntegrityError,
  type RoundLifecycleRoundRecord,
} from "./round-lifecycle";

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
