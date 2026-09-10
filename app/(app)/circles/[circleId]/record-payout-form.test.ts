import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source -- no DOM/React
// render is exercised (matches every other UI ticket in this sequence, see
// record-contribution-form.test.ts's own identical methodology).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./record-payout-form.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a client component using recordPayoutAction (payout.actions.ts) and its own initial state", () => {
  assert.match(rawSource, /^"use client";/);
  assert.match(source, /import \{ recordPayoutAction \} from "@\/src\/actions\/payout\.actions";/);
  assert.match(source, /import \{ initialRecordPayoutState \} from "@\/src\/actions\/payout\.state";/);
  assert.match(source, /useActionState\(recordPayoutAction, initialRecordPayoutState\)/);
});

test("submits exactly circleId, roundId, amount, and clientOperationId -- nothing else", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["amount", "circleId", "clientOperationId", "roundId"]);
});

test("no ownerId, memberId, recipientId, currency-as-a-field, status, or actor/timestamp field exists in the form", () => {
  for (const forbidden of [
    'name="ownerId"',
    'name="memberId"',
    'name="recipientId"',
    'name="currency"',
    'name="status"',
    'name="recordedById"',
    'name="recordedAt"',
    'name="confirmedByMemberId"',
    'name="disputedByMemberId"',
  ]) {
    assert.ok(!source.includes(forbidden), `expected no form field "${forbidden}"`);
  }
});

test("the amount field is a hidden, read-only input fixed to the round's own expectedPayout.amount prop -- never a free-form/editable field", () => {
  assert.match(source, /<input type="hidden" name="amount" value=\{amount\} readOnly \/>/);
  assert.doesNotMatch(source, /<input[^>]*name="amount"[^>]*type="(?:text|number)"/);
});

test("the exact amount is displayed to the owner, not just submitted silently, and no client-side arithmetic computes it", () => {
  assert.match(source, /\{currency\}\s*\{amount\}/);
  assert.match(source, /exact/i);
  assert.doesNotMatch(source, /\breduce\(/);
  assert.doesNotMatch(source, /contributionAmount\s*\*/);
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

test("the returned payout status is rendered truthfully -- RECORDED/CONFIRMED/DISPUTED are three distinct messages, never a generic 'Saved!' or a hard-coded RECORDED assumption", () => {
  assert.match(source, /state\.payout\.status === "RECORDED"/);
  assert.match(source, /state\.payout\.status === "CONFIRMED"/);
  assert.doesNotMatch(source, />\s*Saved!\s*</);
});

test("prevents duplicate submissions while the action is pending", () => {
  assert.match(source, /type="submit"[\s\S]*?disabled=\{pending\}/);
});

test("server errors are shown as returned, never a raw/rethrown error", () => {
  assert.match(source, /state\.formError/);
});

test("copy says 'Record payout' and avoids execution-implying verbs (send/pay/transfer/release/process)", () => {
  assert.match(source, />\s*\{pending \? "Recording…" : "Record payout"\}\s*</);
  for (const forbidden of [/send payout/i, /pay member/i, /transfer funds/i, /release money/i, /process payment/i]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /does not send, hold, or\s+transfer money/i);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
});

test("no optimistic local mutation of payout status before the action resolves", () => {
  assert.doesNotMatch(source, /setState\(.*CONFIRMED/);
  assert.doesNotMatch(source, /useState\(.*RECORDED"\)/);
});
