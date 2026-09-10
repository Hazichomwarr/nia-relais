import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isPayoutTransitionAllowed, PAYOUT_REPLAY_CONTRACT_KEYS } from "./payout-state";

test("RECORDED may transition to CONFIRMED or DISPUTED, and only those two", () => {
  assert.equal(isPayoutTransitionAllowed("RECORDED", "CONFIRMED"), true);
  assert.equal(isPayoutTransitionAllowed("RECORDED", "DISPUTED"), true);
  assert.equal(isPayoutTransitionAllowed("RECORDED", "RECORDED"), false);
});

test("CONFIRMED is terminal -- no outgoing transition exists, including back to RECORDED or over to DISPUTED", () => {
  for (const to of ["RECORDED", "CONFIRMED", "DISPUTED"] as const) {
    assert.equal(isPayoutTransitionAllowed("CONFIRMED", to), false);
  }
});

test("DISPUTED is terminal -- no outgoing transition exists, including back to RECORDED or over to CONFIRMED", () => {
  for (const to of ["RECORDED", "CONFIRMED", "DISPUTED"] as const) {
    assert.equal(isPayoutTransitionAllowed("DISPUTED", to), false);
  }
});

test("there is no reversal/correction transition anywhere in the contract", () => {
  const allStatuses = ["RECORDED", "CONFIRMED", "DISPUTED"] as const;
  const allowedPairs = allStatuses.flatMap((from) =>
    allStatuses.filter((to) => isPayoutTransitionAllowed(from, to)).map((to) => `${from}->${to}`),
  );
  assert.deepEqual(allowedPairs, ["RECORDED->CONFIRMED", "RECORDED->DISPUTED"]);
});

test("the documented replay contract enumerates exactly the races 7K.1 froze, no more and no fewer", () => {
  assert.deepEqual(PAYOUT_REPLAY_CONTRACT_KEYS, [
    "duplicate-recording-operation",
    "recording-intent-conflict",
    "already-recorded-conflict",
    "duplicate-confirmation",
    "confirmation-on-disputed-conflict",
    "duplicate-dispute",
    "dispute-intent-conflict",
    "dispute-on-confirmed-conflict",
  ]);
});

// --- round-lifecycle separation (7K.2 section 11) ---
//
// Checked against CODE with comments stripped, not raw source: this
// file's own doc comment deliberately discusses PayoutRound/
// PayoutRoundStatus in prose (documenting exactly why the two domains
// are separate, per section 5 of this ticket) -- the property under
// test is that no executable logic here couples to round lifecycle, not
// that the word never appears in an explanatory comment.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./payout-state.ts", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this module's code never references PayoutRound, PayoutRoundStatus, or any round-lifecycle transition", () => {
  for (const forbidden of [
    "PayoutRound",
    "PayoutRoundStatus",
    "roundStatus",
    "UPCOMING",
    "closeRound",
    "activateRound",
    "completeCircle",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no code reference to "${forbidden}"`);
  }
});

test("the round-lifecycle separation is documented in the file's own comments, not merely true by omission", () => {
  assert.match(rawSource, /PayoutRound/);
  assert.match(rawSource, /separate/i);
  assert.match(rawSource, /lifecycle domain/i);
});

test("this module has no Prisma/database/service import -- pure domain logic only", () => {
  assert.doesNotMatch(source, /@prisma\/client/);
  assert.doesNotMatch(source, /from ["']@\/src\/services/);
  assert.doesNotMatch(source, /from ["']@\/src\/repositories/);
});
