import assert from "node:assert/strict";
import test from "node:test";

import { selectCurrentAndNextRound } from "./circle-round-selection";

const round = (roundNumber: number, status: string) => ({ roundNumber, status });

test("exactly one ACTIVE round is selected as currentRound, never nextRound", () => {
  const rounds = [round(1, "CLOSED"), round(2, "ACTIVE"), round(3, "UPCOMING")];
  const result = selectCurrentAndNextRound("ACTIVE", rounds);
  assert.deepEqual(result.currentRound, round(2, "ACTIVE"));
  assert.equal(result.nextRound, null);
});

test("with no ACTIVE round, the lowest non-CLOSED round is offered as nextRound, labeled with its own real status", () => {
  const rounds = [round(1, "UPCOMING"), round(2, "UPCOMING"), round(3, "UPCOMING")];
  const result = selectCurrentAndNextRound("ACTIVE", rounds);
  assert.equal(result.currentRound, null);
  assert.deepEqual(result.nextRound, round(1, "UPCOMING"));
});

test("a CLOSED round 1 with UPCOMING round 2 offers round 2 as the lowest non-CLOSED round", () => {
  const rounds = [round(1, "CLOSED"), round(2, "UPCOMING"), round(3, "UPCOMING")];
  const result = selectCurrentAndNextRound("ACTIVE", rounds);
  assert.equal(result.nextRound?.roundNumber, 2);
});

test("a non-ACTIVE circle with no ACTIVE round has neither currentRound nor nextRound", () => {
  const rounds = [round(1, "CLOSED"), round(2, "CLOSED"), round(3, "CLOSED")];
  const completed = selectCurrentAndNextRound("COMPLETED", rounds);
  const archived = selectCurrentAndNextRound("ARCHIVED", rounds);
  assert.deepEqual(completed, { currentRound: null, nextRound: null });
  assert.deepEqual(archived, { currentRound: null, nextRound: null });
});

test("selection is based only on the round's own status field, never on roundNumber alone or any date", () => {
  // roundNumber 1 exists but is CLOSED; roundNumber 2 is UPCOMING and must
  // be offered, proving this never just returns "round 1" blindly.
  const rounds = [round(1, "CLOSED"), round(2, "UPCOMING")];
  const result = selectCurrentAndNextRound("ACTIVE", rounds);
  assert.equal(result.nextRound?.roundNumber, 2);
});

test("works generically over any object shape that has roundNumber and status", () => {
  const richRounds = [
    { roundNumber: 1, status: "UPCOMING", recipientDisplayName: "Amara", extra: 123 },
    { roundNumber: 2, status: "UPCOMING", recipientDisplayName: "Kwame", extra: 456 },
  ];
  const result = selectCurrentAndNextRound("ACTIVE", richRounds);
  assert.equal(result.nextRound?.recipientDisplayName, "Amara");
});
