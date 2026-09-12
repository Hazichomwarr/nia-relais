import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source -- no DOM/React
// render is exercised here (matches round-lifecycle-controls.test.ts's own
// identical methodology for the sibling owner lifecycle controls).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./complete-circle-controls.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a client component using completeCircleAction and its own initial state", () => {
  assert.match(rawSource, /^"use client";/);
  assert.match(source, /import \{ completeCircleAction \} from "@\/src\/actions\/circle-completion\.actions";/);
  assert.match(source, /import \{ initialCompleteCircleState \} from "@\/src\/actions\/circle-completion\.state";/);
  assert.match(source, /useActionState\(completeCircleAction, initialCompleteCircleState\)/);
});

test("CompleteCircleForm submits exactly circleId -- nothing else", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes, ["circleId"]);
});

test("contains no ownerId/status/completedAt/completedById/roundId/archive field", () => {
  for (const forbidden of [
    'name="ownerId"',
    'name="status"',
    'name="completedAt"',
    'name="completedById"',
    'name="roundId"',
    'name="archive"',
  ]) {
    assert.ok(!source.includes(forbidden), `expected no form field "${forbidden}"`);
  }
});

test("shows truthful pending copy and disables its submit while pending", () => {
  assert.match(source, /type="submit"[\s\S]*?disabled=\{pending\}/);
  assert.match(source, />\s*\{pending \? "Completing circle…" : "Complete circle"\}\s*</);
});

test("renders the server-returned success message and error, never a fabricated local one", () => {
  assert.match(source, /state\.status === "success" && state\.message/);
  assert.match(source, /state\.formError/);
});

test("sets no optimistic status via useState -- the authoritative server revalidation determines the resulting page state", () => {
  assert.doesNotMatch(source, /useState\(/);
});

test("no direct Prisma, repository, or completion-service reference -- this file only ever submits to completeCircleAction", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of [
    "@/src/repositories/circle-completion.repository",
    "@/src/services/circle-completion.service",
    "@/src/actions/complete-circle\"",
    "requireCircleMember",
    "validateCircleMemberSession",
    "nia_member_session",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no eligibility computation of any kind -- this component renders only what its own props/action-state already say", () => {
  for (const forbidden of [
    "ContributionPayment",
    "ContributionObligation",
    "payout.status",
    "assessContributionClosureReadiness",
    "assessPayoutClosureReadiness",
    ".every(",
    ".filter(",
    ".reduce(",
    "Date.now(",
    "new Date(",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no archive language anywhere in this file", () => {
  assert.doesNotMatch(source, /archive/i);
});

test("no celebratory financial-transfer copy -- money moved outside NIA, never claimed as executed by NIA", () => {
  for (const forbidden of [/funds transferred/i, /money (was )?sent/i, /payout completed by nia/i, /distributed by nia/i]) {
    assert.doesNotMatch(source, forbidden);
  }
});
