import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural/source-inspection evidence for 9E's activateImportedCircle --
// the transaction itself needs a real, reachable database with the 9C
// migration applied (unavailable in this environment: DATABASE_URL points
// at Neon, and 9E's own ticket explicitly forbids claiming live
// persistence success while that schema is stale -- see §23/§24). This
// file proves everything that CAN be proven from source alone: reuse
// (never a second schedule/structure generator), routing, atomicity
// shape, replay ordering, and that normal (NEW-origin) activation is
// untouched. Pure business-rule evidence (K bounds, historical-shape
// coherence, no ContributionPayment fabrication) lives in
// circle-imported-activation.test.ts, executed directly against the real
// exported functions -- not regex-matched.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const circleService = readFileSync(new URL("./circle.service.ts", import.meta.url), "utf8");
const circleServiceCode = stripComments(circleService);
const circleRepository = readFileSync(new URL("../repositories/circle.repository.ts", import.meta.url), "utf8");
const activateCircleAction = readFileSync(new URL("../actions/activate-circle.ts", import.meta.url), "utf8");
const roundLifecycleService = readFileSync(new URL("./round-lifecycle.service.ts", import.meta.url), "utf8");

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `expected to find "${name}"`);
  // Every function this file inspects is followed by at least one more
  // top-level export/const before EOF -- slice to the next top-level
  // "export " after the signature, or EOF if none follows.
  const next = source.indexOf("\nexport ", start + name.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

// -------------------------------------------------------------------
// 1. Normal activation is completely unchanged (ticket §2)
// -------------------------------------------------------------------

test("activateCircle still contains its own unmodified 9D.1 IMPORTED guard, and gains no K/import-reconstruction logic of its own", () => {
  const body = extractFunction(circleServiceCode, "export async function activateCircle(input: {");
  assert.match(body, /circle\.originKind === "IMPORTED"/);
  assert.match(body, /throw new CircleActivationEligibilityError\(IMPORTED_ACTIVATION_NOT_READY_MESSAGE\)/);
  // activateCircle's own DRAFT-branch write sequence is exactly: generate
  // rounds, generate obligations, markCircleActive, re-verify -- never a
  // historicalCompletedRoundCount read, never createImportedRoundPayouts,
  // never assertImportedReconstructionIntegrity.
  assert.doesNotMatch(body, /historicalCompletedRoundCount/);
  assert.doesNotMatch(body, /createImportedRoundPayouts/);
  assert.doesNotMatch(body, /assertImportedReconstructionIntegrity/);
  assert.doesNotMatch(body, /assertImportedActivationKBounds/);
});

test("markCircleActive's normal (NEW-origin) call site never supplies importedAt/importedById", () => {
  const normalBody = extractFunction(circleServiceCode, "export async function activateCircle(input: {");
  const normalCall = normalBody.match(/const transitioned = await markCircleActive\(transaction, \{[\s\S]*?\}\);/)?.[0] ?? "";
  assert.ok(normalCall.length > 0, "expected to find markCircleActive's call site in activateCircle");
  assert.doesNotMatch(normalCall, /importedAt|importedById/);
});

// Originally asserted round-lifecycle.service.ts (activateFirstRound AND
// advanceRound) carried no import vocabulary at all -- true through 9E,
// since first-live-round generalization was explicitly out of 9E's own
// scope ("9E does NOT activate round K+1"). 9F
// (docs/product/susu-existing-import-contract-freeze.md §6) is precisely
// the ticket that generalizes activateFirstRound to derive K+1 for an
// IMPORTED circle -- see round-lifecycle-first-live-round.test.ts and
// round-lifecycle-9f-preservation.test.ts for 9F's own direct evidence.
// What must remain true through 9F: advanceRound itself carries none of
// this vocabulary (subsequent K+2+ progression is unmodified, ordinary
// Phase 7 lifecycle -- ticket 9F §16).
test("round-lifecycle.service.ts's advanceRound remains untouched through 9F -- no import vocabulary, no K+1 derivation; only activateFirstRound (9F's own scope) now carries it", () => {
  const advanceRoundBody = roundLifecycleService.slice(roundLifecycleService.indexOf("export async function advanceRound"));
  assert.doesNotMatch(
    advanceRoundBody,
    /IMPORTED_DECLARATION|historicalCompletedRoundCount|originKind|closureBasis|fulfillmentBasis|confirmationBasis|firstLiveRoundNumber/,
  );
});

// -------------------------------------------------------------------
// 2. Reuse -- never a second schedule/structure generator (ticket §1/§7)
// -------------------------------------------------------------------

test("activateImportedCircle reuses roundDueDate, never a second date-math implementation", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  assert.match(body, /roundDueDate\(circle, member\.payoutOrder!\)/);
});

test("activateImportedCircle reuses createCircleActivationRounds/createCircleActivationObligations -- the SAME functions activateCircle calls, not a second generator", () => {
  const importedBody = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  const normalBody = extractFunction(circleServiceCode, "export async function activateCircle(input: {");
  for (const fn of ["createCircleActivationRounds(transaction", "createCircleActivationObligations(transaction"]) {
    assert.match(importedBody, new RegExp(fn.replace(/[()]/g, "\\$&")));
    assert.match(normalBody, new RegExp(fn.replace(/[()]/g, "\\$&")));
  }
  // Only one definition of each in the repository -- not two overloaded-by-name functions.
  assert.equal((circleRepository.match(/export function createCircleActivationRounds/g) ?? []).length, 1);
  assert.equal((circleRepository.match(/export function createCircleActivationObligations/g) ?? []).length, 1);
});

test("activateImportedCircle reuses assertActivationEligible, assertFreshReviewMatches, and assertActivatedRotationIntegrity unchanged -- never a parallel eligibility/review/integrity check", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  assert.match(body, /assertActivationEligible\(circle, members, rounds, obligations\)/);
  assert.match(body, /assertFreshReviewMatches\(input\.expectedFingerprint, circle, members\)/);
  assert.match(body, /assertActivatedRotationIntegrity\(/);
  // Each of these functions is still defined exactly once.
  for (const fn of ["assertActivationEligible", "assertFreshReviewMatches", "assertActivatedRotationIntegrity"]) {
    assert.equal((circleServiceCode.match(new RegExp(`function ${fn}\\(`, "g")) ?? []).length, 1, `${fn} must be defined exactly once`);
  }
});

test("the historical payout amount reuses computeExpectedPayoutAmount (payout-accounting.ts) -- never a second contributionAmount*N formula", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  assert.match(body, /computeExpectedPayoutAmount\(/);
  assert.match(circleServiceCode, /import \{ computeExpectedPayoutAmount \} from "@\/src\/domain\/payout-accounting";/);
});

// -------------------------------------------------------------------
// 3. K+1 is never activated; zero ACTIVE rounds guaranteed (ticket §14)
// -------------------------------------------------------------------

test("createCircleActivationRounds can only ever write CLOSED or UPCOMING -- ACTIVE is not a reachable status from this writer", () => {
  const fn = circleRepository.match(/export function createCircleActivationRounds\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(fn.length > 0);
  assert.doesNotMatch(fn, /"ACTIVE"/);
  assert.match(fn, /status: round\.closedImport \? "CLOSED" : "UPCOMING"/);
});

test("activateImportedCircle never calls activateLifecycleRound or any round-lifecycle writer -- K+1 is left exactly as created (UPCOMING)", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  for (const forbidden of ["activateLifecycleRound", "closeLifecycleRound", "activateFirstRound", "advanceRound"]) {
    assert.ok(!body.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

// -------------------------------------------------------------------
// 4. Atomicity -- one transaction, no partial commit (ticket §18)
// -------------------------------------------------------------------

test("activateImportedCircle's entire fresh-DRAFT reconstruction happens inside a single prisma.$transaction, with the lock taken first", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  assert.match(body, /return prisma\.\$transaction\(async \(transaction\) => \{/);
  const lockIndex = body.indexOf("lockSavingsCircleForUpdate(transaction, input.circleId)");
  const roundsIndex = body.indexOf("createCircleActivationRounds(transaction");
  const obligationsIndex = body.indexOf("createCircleActivationObligations(transaction");
  const payoutsIndex = body.indexOf("createImportedRoundPayouts(transaction");
  const activeIndex = body.indexOf("markCircleActive(transaction");
  assert.ok(lockIndex >= 0 && lockIndex < roundsIndex, "lock must be acquired before round creation");
  assert.ok(roundsIndex < obligationsIndex, "rounds must be created before obligations");
  assert.ok(obligationsIndex < payoutsIndex, "obligations must be created before historical payouts");
  assert.ok(payoutsIndex < activeIndex, "historical payouts must be created before the ACTIVE transition");
  // No early "return" (a commit) between the lock and the final ACTIVE
  // transition on the fresh-DRAFT path -- every guard between them
  // throws, it never resolves the transaction promise early.
  const freshPath = body.slice(body.indexOf('if (circle.status !== "DRAFT")'), activeIndex);
  assert.doesNotMatch(freshPath, /\breturn\b/);
});

test("every write in activateImportedCircle's fresh path is verified by a written-row-count check before proceeding", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  assert.match(body, /if \(createdObligations\.count !== members\.length \*\* 2\) \{\s*throw new CircleActivationIntegrityError\(\);/);
  assert.match(body, /if \(createdPayouts\.length !== K\) throw new CircleActivationIntegrityError\(\);/);
  assert.match(body, /if \(transitioned\.count !== 1\) throw new CircleActivationIntegrityError\(\);/);
});

test("the transaction's final self-check re-reads persisted state and re-verifies BOTH structural and imported-reconstruction integrity before returning", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  const selfCheckStart = body.lastIndexOf("assertActivatedRotationIntegrity(activatedCircle");
  const selfCheckEnd = body.lastIndexOf("assertImportedReconstructionIntegrity(activatedCircle");
  assert.ok(selfCheckStart >= 0 && selfCheckEnd > selfCheckStart, "expected both final self-checks, in order");
});

// -------------------------------------------------------------------
// 5. Replay behavior (ticket §17)
// -------------------------------------------------------------------

test("the ACTIVE-replay branch re-verifies imported reconstruction integrity and writes nothing", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  const replayBranch = body.slice(body.indexOf('if (circle.status === "ACTIVE")'), body.indexOf('if (circle.status !== "DRAFT")'));
  assert.match(replayBranch, /assertImportedReconstructionIntegrity\(circle, rounds, obligations, payouts\)/);
  assert.doesNotMatch(replayBranch, /\.(create|createMany|update|updateMany)\(/);
});

test("K/N validation only ever runs on the fresh-DRAFT path, never on replay -- an already-imported circle's K is never re-validated against a possibly-different live cohort", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  const activeReplayEnd = body.indexOf('if (circle.status !== "DRAFT")');
  const kBoundsIndex = body.indexOf("assertImportedActivationKBounds(K, N)");
  assert.ok(kBoundsIndex > activeReplayEnd, "K/N validation must run only after the DRAFT-only branch begins");
});

// -------------------------------------------------------------------
// 6. Authority / security (ticket §3/§4/§21)
// -------------------------------------------------------------------

test("activateImportedCircle takes only ownerId/circleId/expectedFingerprint as input -- no K, originKind, terms, member, or payout-order field", () => {
  const signatureMatch = circleServiceCode.match(/export async function activateImportedCircle\(input: \{([\s\S]*?)\}\): Promise<ImportedCircleActivationResult>/);
  assert.ok(signatureMatch, "expected to find activateImportedCircle's input type");
  const fieldNames = [...signatureMatch![1].matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((match) => match[1]);
  assert.deepEqual(fieldNames.sort(), ["circleId", "expectedFingerprint", "ownerId"]);
});

test("importedById/recordedById for every historical write is always input.ownerId -- never a client-supplied actor id", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  assert.match(body, /byId: input\.ownerId/);
  assert.match(body, /recordedById: input\.ownerId/);
  assert.match(body, /importedById: input\.ownerId/);
  assert.match(body, /activatedById: input\.ownerId/);
  assert.doesNotMatch(body, /importedById:\s*input\.importedById/);
});

test("ownership is re-verified fresh under the lock before the origin/status checks -- identical position to activateCircle's own check", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  const ownerCheckIndex = body.indexOf("circle.ownerId !== input.ownerId");
  const originCheckIndex = body.indexOf('circle.originKind !== "IMPORTED"');
  assert.ok(ownerCheckIndex >= 0 && ownerCheckIndex < originCheckIndex, "ownership must be verified before the origin check");
});

test("no member-session identity system is referenced anywhere in imported activation", () => {
  const body = extractFunction(circleServiceCode, "export async function activateImportedCircle(input: {");
  for (const forbidden of ["requireCircleMember", "nia_member_session", "CircleMemberSession"]) {
    assert.ok(!body.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

// -------------------------------------------------------------------
// 7. Routing (ticket §2/§27)
// -------------------------------------------------------------------

test("the activate-circle action routes to activateImportedCircle only when the fresh review's own originKind is IMPORTED, never activateCircle for both", () => {
  assert.match(activateCircleAction, /currentReview\.circle\.originKind === "IMPORTED"/);
  assert.match(activateCircleAction, /deps\.activateImportedCircle\(/);
  assert.match(activateCircleAction, /deps\.activateCircle\(/);
});

test("the router recomputes eligibility/staleness from the SAME fresh review before deciding which function to call -- it does not trust a client-submitted origin", () => {
  const routingStart = activateCircleAction.indexOf("const result = currentReview.circle.originKind");
  const staleCheckIndex = activateCircleAction.indexOf("computeActivationReviewFingerprint(currentReview) !== submittedFingerprint");
  assert.ok(staleCheckIndex >= 0 && staleCheckIndex < routingStart, "the staleness check must run before routing/activation");
});
