import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Focused structural checks for 9F's new IMPORTED_PREFIX_AWAITING_FIRST_ROUND
// branch in round-lifecycle-card.tsx only -- deliberately a separate file
// from round-lifecycle-card.test.ts, which has substantial pre-existing
// drift against an earlier component shape (getBlockerMessage,
// label="Current round" as a literal, ...) unrelated to 9F and out of this
// ticket's scope to reconcile. This file targets exactly the new branch
// 9F added, against the actual current source.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./round-lifecycle-card.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

const importedPrefixBranch = source.slice(
  source.indexOf('phase === "IMPORTED_PREFIX_AWAITING_FIRST_ROUND"'),
  source.indexOf('phase === "IN_PROGRESS"'),
);

test("the IMPORTED_PREFIX_AWAITING_FIRST_ROUND branch exists, between NOT_STARTED and IN_PROGRESS", () => {
  assert.ok(importedPrefixBranch.length > 0);
});

test("renders StartFirstRoundForm with variant=\"imported\" only when progression.canStartFirstRound is true -- never unconditionally", () => {
  assert.match(importedPrefixBranch, /progression\.canStartFirstRound \? <StartFirstRoundForm circleId=\{circleId\} dictionary=\{dictionary\} variant="imported" \/> : null/);
});

test("the description is built from the read model's own closedRounds/nextRound.roundNumber -- never a hardcoded K or round number", () => {
  assert.match(importedPrefixBranch, /copy\.importedPrefixDescription\.replace\("\{count\}", String\(closedRounds\)\)\.replace\("\{number\}", String\(nextRound\.roundNumber\)\)/);
});

test("shows the target round via RoundSummary using its own true roundNumber, never a hardcoded '1'", () => {
  assert.match(importedPrefixBranch, /<RoundSummary label=\{`\$\{copy\.round\} \$\{nextRound\.roundNumber\}`\} round=\{nextRound\} dictionary=\{dictionary\} \/>/);
});

test("never renders AdvanceRoundForm or CompleteCircleForm alongside the first-live-round start control", () => {
  assert.doesNotMatch(importedPrefixBranch, /AdvanceRoundForm/);
  assert.doesNotMatch(importedPrefixBranch, /CompleteCircleForm/);
});

test("no date-based gating in the new branch", () => {
  assert.doesNotMatch(importedPrefixBranch, /Date\.now\(\)/);
  assert.doesNotMatch(importedPrefixBranch, /new Date\(/);
});

test("never claims the historical rounds were NIA-confirmed/NIA-managed", () => {
  for (const forbidden of [/NIA confirmed/i, /NIA managed/i, /NIA witnessed/i]) {
    assert.doesNotMatch(importedPrefixBranch, forbidden);
  }
});

test("the i18n key exists in both EN and FR dictionaries with matching {count}/{number} placeholders", () => {
  const en = readFileSync(new URL("../../../../src/i18n/dictionaries/en.ts", import.meta.url), "utf8");
  const fr = readFileSync(new URL("../../../../src/i18n/dictionaries/fr.ts", import.meta.url), "utf8");
  for (const dict of [en, fr]) {
    assert.match(dict, /importedPrefixDescription:\s*"[^"]*\{count\}[^"]*\{number\}[^"]*"/);
    assert.match(dict, /startNiaTracking:\s*"[^"]+"/);
    assert.match(dict, /startingNiaTracking:\s*"[^"]+"/);
  }
});
