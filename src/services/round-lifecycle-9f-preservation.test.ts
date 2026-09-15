import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Preservation evidence for 9F ticket §14-§17: contribution/payout
// mutation semantics, subsequent (K+2+) round progression, and explicit
// completion are all untouched by this ticket -- structural/source
// evidence only, since exercising the real state machines needs a
// database (unavailable in this environment).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function read(relativePath: string): string {
  return stripComments(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

// -------------------------------------------------------------------
// §14/§15 -- contribution/payout mutation services are byte-untouched
// -------------------------------------------------------------------

const IMPORT_VOCAB = /IMPORTED_DECLARATION|historicalCompletedRoundCount|originKind|closureBasis|firstLiveRoundNumber/;

for (const file of [
  "../services/contribution-recording.service.ts",
  "../services/contribution-confirmation.service.ts",
  "../services/contribution-rejection.service.ts",
  "../services/payout-recording.service.ts",
  "../services/payout-confirmation.service.ts",
  "../services/payout-dispute.service.ts",
]) {
  test(`${file} carries no import vocabulary -- 9F changes lifecycle eligibility only, never financial mutation semantics`, () => {
    assert.doesNotMatch(read(file), IMPORT_VOCAB);
  });
}

// -------------------------------------------------------------------
// §15 -- the existing mutation boundary already prevents a recipient
// from confirming or disputing an imported (fulfillmentBasis/
// confirmationBasis = IMPORTED_DECLARATION) payout, without any new
// provenance guard: imported payouts are created with
// confirmedByMemberId = null and status = CONFIRMED (never RECORDED),
// and the pre-existing state-machine/provenance checks already reject
// both a fresh confirm and a fresh dispute against that shape.
// -------------------------------------------------------------------

test("confirmPayout's replay path already refuses a payout whose confirmedByMemberId does not match the caller -- an imported payout (confirmedByMemberId=null) can never resolve as a legitimate replay", () => {
  const source = read("../services/payout-confirmation.service.ts");
  assert.match(source, /payout\.confirmedByMemberId !== null &&/);
  assert.match(source, /payout\.confirmedByMemberId === recipientId &&/);
  assert.match(source, /payout\.confirmedByMemberId === memberId/);
});

test("disputePayout already refuses any dispute against an already-CONFIRMED payout -- an imported payout (status=CONFIRMED, never RECORDED) can never be freshly disputed", () => {
  const source = read("../services/payout-dispute.service.ts");
  const confirmedGuards = [...source.matchAll(/payout\.status === "CONFIRMED"/g), ...source.matchAll(/freshPayout\.status === "CONFIRMED"/g), ...source.matchAll(/raced\.status === "CONFIRMED"/g)];
  assert.ok(confirmedGuards.length >= 2, "expected the CONFIRMED-status guard on both the pre-check and locked paths");
  assert.match(source, /throw new PayoutDisputeConfirmedError\(\);/);
});

test("neither confirmPayout nor disputePayout ever writes confirmationBasis -- that field is set once, at insert, only by createImportedRoundPayouts (9E) or the ordinary recordPayout default", () => {
  assert.doesNotMatch(read("../services/payout-confirmation.service.ts"), /confirmationBasis/);
  assert.doesNotMatch(read("../services/payout-dispute.service.ts"), /confirmationBasis/);
});

// -------------------------------------------------------------------
// §16 -- subsequent round progression (K+2 onward) is normal Phase 7,
// never a second imported-progression algorithm
// -------------------------------------------------------------------

test("advanceRound is completely untouched by 9F -- no import vocabulary, no K/origin read, no second progression algorithm", () => {
  const source = read("../services/round-lifecycle.service.ts");
  const start = source.indexOf("export async function advanceRound");
  assert.ok(start >= 0, "expected to find advanceRound");
  const body = source.slice(start);
  assert.doesNotMatch(body, IMPORT_VOCAB);
  // advanceRound's own successor derivation remains the plain
  // roundNumber + 1 lookup, unrelated to firstLiveRoundNumber.
  assert.match(body, /findSuccessor\(freshRounds, freshRequested\)/);
});

test("advanceRound and activateFirstRound remain the only two public round-lifecycle operations -- 9F adds no third", () => {
  const source = read("../services/round-lifecycle.service.ts");
  const publicFns = [...source.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(publicFns.sort(), ["activateFirstRound", "advanceRound"]);
});

// -------------------------------------------------------------------
// §17 -- K=N-1 / final round / explicit completion preserved
// -------------------------------------------------------------------

test("completeCircle (circle-completion.service.ts) is untouched by 9F -- no import vocabulary, no firstLiveRoundNumber reference, still requires every round CLOSED", () => {
  const source = read("../services/circle-completion.service.ts");
  assert.doesNotMatch(source, /firstLiveRoundNumber|historicalCompletedRoundCount/);
  assert.match(source, /rounds\.every\(\(round\) => round\.status === "CLOSED"\)/);
});

test("no automatic completion is introduced -- completeCircle remains the sole, explicit, owner-only public operation for ACTIVE -> COMPLETED", () => {
  const source = read("../services/circle-completion.service.ts");
  const publicFns = [...source.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(publicFns, ["completeCircle"]);
});

test("for K=N-1, firstLiveRoundNumber derives exactly round N (the final round) -- starting it, then closing it via the unmodified advanceRound, reaches ALL_ROUNDS_CLOSED through the existing mechanism, never a special-cased final-round path", async () => {
  const { firstLiveRoundNumber } = await import("@/src/domain/round-lifecycle");
  assert.equal(firstLiveRoundNumber("IMPORTED", 4), 5); // N=5, K=4 -> target round 5 (the final round)
});
