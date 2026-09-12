import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source -- no DOM/React
// render is exercised here (matches every other UI ticket in this
// sequence, see record-payout-form.test.ts's own identical methodology).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./round-lifecycle-controls.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a client component using activateFirstRoundAction/advanceRoundAction and their own initial states", () => {
  assert.match(rawSource, /^"use client";/);
  assert.match(
    source,
    /import \{ activateFirstRoundAction, advanceRoundAction \} from "@\/src\/actions\/round-lifecycle\.actions";/,
  );
  assert.match(
    source,
    /import \{ initialActivateFirstRoundState, initialAdvanceRoundState \} from "@\/src\/actions\/round-lifecycle\.state";/,
  );
  assert.match(source, /useActionState\(activateFirstRoundAction, initialActivateFirstRoundState\)/);
  assert.match(source, /useActionState\(advanceRoundAction, initialAdvanceRoundState\)/);
});

// --- StartFirstRoundForm ---

function extractFunctionSource(name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const nextExport = source.indexOf("export function ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

const startFirstRoundSource = extractFunctionSource("StartFirstRoundForm");

test("StartFirstRoundForm submits exactly circleId -- nothing else", () => {
  const nameAttributes = [...startFirstRoundSource.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes, ["circleId"]);
});

test("StartFirstRoundForm contains no ownerId/status/actor/timestamp/recipient/round field", () => {
  for (const forbidden of [
    'name="ownerId"',
    'name="roundId"',
    'name="status"',
    'name="activatedAt"',
    'name="activatedById"',
    'name="dueDate"',
    'name="recipientId"',
    'name="nextRoundId"',
  ]) {
    assert.ok(!startFirstRoundSource.includes(forbidden), `expected no form field "${forbidden}" in StartFirstRoundForm`);
  }
});

test("StartFirstRoundForm shows truthful pending copy and disables its submit while pending", () => {
  assert.match(startFirstRoundSource, /type="submit"[\s\S]*?disabled=\{pending\}/);
  assert.match(startFirstRoundSource, />\s*\{pending \? "Starting round…" : "Start round 1"\}\s*</);
});

test("StartFirstRoundForm renders the server-returned success message and error, never a fabricated local one", () => {
  assert.match(startFirstRoundSource, /state\.status === "success" && state\.message/);
  assert.match(startFirstRoundSource, /state\.formError/);
});

test("StartFirstRoundForm sets no optimistic lifecycle status via useState", () => {
  assert.doesNotMatch(startFirstRoundSource, /useState\(/);
});

// --- AdvanceRoundForm ---

const advanceRoundSource = extractFunctionSource("AdvanceRoundForm");

test("AdvanceRoundForm submits exactly circleId and roundId -- nothing else", () => {
  const nameAttributes = [...advanceRoundSource.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["circleId", "roundId"]);
});

test("AdvanceRoundForm contains no nextRoundId/closedAt/closedById/activatedAt/activatedById/status/recipientId/financial/ownerId field", () => {
  for (const forbidden of [
    'name="nextRoundId"',
    'name="closedAt"',
    'name="closedById"',
    'name="activatedAt"',
    'name="activatedById"',
    'name="status"',
    'name="recipientId"',
    'name="ownerId"',
    'name="isFinalRound"',
    'name="financialReady"',
  ]) {
    assert.ok(!advanceRoundSource.includes(forbidden), `expected no form field "${forbidden}" in AdvanceRoundForm`);
  }
});

test("AdvanceRoundForm derives its CTA label from getAdvanceCtaLabel, never a hand-rolled conditional string", () => {
  assert.match(source, /import \{ getAdvanceCtaLabel \} from "\.\/round-lifecycle-display";/);
  assert.match(advanceRoundSource, /getAdvanceCtaLabel\(transitionKind, currentRoundNumber, nextRoundNumber\)/);
});

test("AdvanceRoundForm shows truthful pending copy and disables its submit while pending", () => {
  assert.match(advanceRoundSource, /type="submit"[\s\S]*?disabled=\{pending\}/);
  assert.match(advanceRoundSource, /\{pending \? "Updating round…" : ctaLabel\}/);
});

test("AdvanceRoundForm's supporting copy never implies two independent operations, and the final-round copy never implies circle completion", () => {
  assert.match(advanceRoundSource, /one operation, not two/);
  assert.match(advanceRoundSource, /This closes the final rotation round\./);
  for (const forbidden of [/complete circle/i, /finish susu/i, /archive circle/i, /circle completed/i]) {
    assert.doesNotMatch(advanceRoundSource, forbidden);
  }
});

test("AdvanceRoundForm renders the server-returned success message and error, never a fabricated local one", () => {
  assert.match(advanceRoundSource, /state\.status === "success" && state\.message/);
  assert.match(advanceRoundSource, /state\.formError/);
});

test("AdvanceRoundForm sets no optimistic lifecycle status via useState", () => {
  assert.doesNotMatch(advanceRoundSource, /useState\(/);
});

// --- shared boundary checks across the whole file ---

test("no direct Prisma reference, repository import, or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of [
    "@/src/repositories/round-lifecycle.repository",
    "@/src/repositories/round-lifecycle-owner-read.repository",
    "@/src/repositories/circle-lock.repository",
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct round-lifecycle-owner-read.service import -- this file only ever submits to the two actions", () => {
  assert.ok(!source.includes("round-lifecycle-owner-read.service"));
});

test("no financial-eligibility computation of any kind (this file only renders what its props/state already say)", () => {
  for (const forbidden of [
    "ContributionPayment",
    "ContributionObligation",
    "payout.status",
    "confirmedAt",
    "disputeReason",
    ".every(",
    ".filter(",
    ".reduce(",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no circle-completion identifier anywhere in this file", () => {
  for (const forbidden of ["completeCircle", "completeSavingsCircle", "archiveCircle", "COMPLETED", "completedAt", "completedById"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no date-based gating -- no Date.now()/new Date() comparison anywhere in this file", () => {
  assert.doesNotMatch(source, /Date\.now\(\)/);
  assert.doesNotMatch(source, /new Date\(/);
});
