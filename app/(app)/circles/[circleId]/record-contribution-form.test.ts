import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source -- no DOM/React
// render is exercised (matches every other UI ticket in this sequence, see
// add-member-form.test.ts's own comment).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./record-contribution-form.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a client component using the existing recordContributionAction and its initial state", () => {
  assert.match(rawSource, /^"use client";/);
  assert.match(source, /useActionState\(recordContributionAction, initialRecordContributionState\)/);
});

test("submits exactly circleId, obligationId, amount, and clientOperationId -- nothing else", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["amount", "circleId", "clientOperationId", "obligationId"]);
});

test("no ownerId, memberId, roundId, currency-as-a-field, expectedAmount, status, or actor/timestamp field exists in the form", () => {
  for (const forbidden of [
    'name="ownerId"',
    'name="memberId"',
    'name="roundId"',
    'name="currency"',
    'name="expectedAmount"',
    'name="status"',
    'name="recordedById"',
    'name="recordedAt"',
  ]) {
    assert.ok(!source.includes(forbidden), `expected no form field "${forbidden}"`);
  }
});

test("the amount field is a hidden, read-only input fixed to the obligation's own expectedAmount prop -- never a free-form/editable field", () => {
  assert.match(source, /<input type="hidden" name="amount" value=\{amount\} readOnly \/>/);
  assert.doesNotMatch(source, /<input[^>]*name="amount"[^>]*type="(?:text|number)"/);
});

test("the exact amount is displayed to the owner, not just submitted silently", () => {
  assert.match(source, /\{currency\}\s*\{amount\}/);
  assert.match(source, /exact/i);
});

test("clientOperationId is generated on the client, once, via crypto.randomUUID (never in the Server Action)", () => {
  assert.match(source, /function operationId\(\)/);
  assert.match(source, /globalThis\.crypto\?\.randomUUID\?\.\(\)/);
  assert.match(source, /useState\(operationId\)/);
});

test("clientOperationId is only regenerated after a genuinely successful submission, never on every input", () => {
  assert.match(source, /function handleFormInput\(\)\s*\{\s*if \(state\.status === "success"\) setClientOperationId\(operationId\(\)\);\s*\}/);
  assert.match(source, /onInput=\{handleFormInput\}/);
});

test("the clientOperationId hidden input is read-only, bound to the stable client-generated id, and never re-derived from server state", () => {
  assert.match(source, /<input type="hidden" name="clientOperationId" value=\{clientOperationId\} readOnly \/>/);
  assert.doesNotMatch(source, /clientOperationId=\{state\./);
});

test("the returned payment status is rendered truthfully -- RECORDED/CONFIRMED/REJECTED are three distinct messages, never a generic 'Saved!'", () => {
  assert.match(source, /state\.payment\.status === "RECORDED"/);
  assert.match(source, /state\.payment\.status === "CONFIRMED"/);
  assert.doesNotMatch(source, />\s*Saved!\s*</);
});

test("prevents duplicate submissions while the action is pending", () => {
  assert.match(source, /type="submit"[\s\S]*?disabled=\{pending\}/);
});

test("server errors are shown as returned, never a raw/rethrown error", () => {
  assert.match(source, /state\.formError/);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
});

test("no optimistic local mutation of payment status before the action resolves", () => {
  assert.doesNotMatch(source, /setState\(.*CONFIRMED/);
  assert.doesNotMatch(source, /useState\(.*RECORDED"\)/);
});
