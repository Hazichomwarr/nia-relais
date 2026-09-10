import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source -- no DOM/React
// render is exercised (matches every other UI ticket in this sequence,
// see contribution-payment-controls.test.ts's own identical methodology
// for the owner-side sibling with the same confirm/reject shape).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./member-payout-controls.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a client component using confirmPayoutAction and disputePayoutAction with their own initial states", () => {
  assert.match(rawSource, /^"use client";/);
  assert.match(source, /import \{ confirmPayoutAction, disputePayoutAction \} from "@\/src\/actions\/payout\.actions";/);
  assert.match(
    source,
    /import \{ initialConfirmPayoutState, initialDisputePayoutState \} from "@\/src\/actions\/payout\.state";/,
  );
  assert.match(source, /useActionState\(\s*confirmPayoutAction,\s*initialConfirmPayoutState,?\s*\)/);
  assert.match(source, /useActionState\(\s*disputePayoutAction,\s*initialDisputePayoutState,?\s*\)/);
});

test("the confirm form submits only circleId and payoutId -- no memberId, recipientId, or financial field", () => {
  const confirmFormMatch = source.match(/<form action=\{confirmAction\}>[\s\S]*?<\/form>/);
  assert.ok(confirmFormMatch, "expected to find the confirm <form>");
  const nameAttributes = [...confirmFormMatch![0].matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["circleId", "payoutId"]);
});

test("the dispute form submits only circleId, payoutId, and disputeReason -- no memberId, recipientId, or actor field", () => {
  const disputeFormMatch = source.match(/<form\s+action=\{disputeAction\}[\s\S]*?<\/form>/);
  assert.ok(disputeFormMatch, "expected to find the dispute <form>");
  const nameAttributes = [...disputeFormMatch![0].matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["circleId", "disputeReason", "payoutId"]);
});

test("no ownerId, memberId, recipientId, amount, currency, or status field exists anywhere in this component", () => {
  for (const forbidden of [
    'name="ownerId"',
    'name="memberId"',
    'name="recipientId"',
    'name="amount"',
    'name="currency"',
    'name="status"',
    'name="recordedById"',
    'name="confirmedByMemberId"',
    'name="disputedByMemberId"',
  ]) {
    assert.ok(!source.includes(forbidden), `expected no form field "${forbidden}"`);
  }
});

test("the dispute reason textarea has a visible label and is bounded to the schema's 500-character maximum", () => {
  assert.match(source, /<label htmlFor=\{`dispute-reason-\$\{payoutId\}`\}/);
  assert.match(source, /<textarea[\s\S]*?maxLength=\{500\}/);
});

test("both controls are cross-disabled while either action is pending", () => {
  assert.match(source, /const anyPending = confirmPending \|\| disputePending;/);
  assert.match(source, /disabled=\{anyPending\}/);
});

test("pending copy is truthful and distinct for each action", () => {
  assert.match(source, /\{confirmPending \? "Confirming…" : "Confirm receipt"\}/);
  assert.match(source, /\{disputePending \? "Submitting dispute…" : "Submit dispute"\}/);
});

test("the dispute submit button is also disabled while the reason is empty/whitespace-only", () => {
  assert.match(source, /disabled=\{anyPending \|\| disputeReason\.trim\(\)\.length === 0\}/);
});

test("cancelling the dispute form performs no submission -- a plain local state reset, never a call to disputeAction", () => {
  assert.match(source, /onClick=\{\(\) => \{\s*setShowDisputeForm\(false\);\s*setDisputeReason\(""\);\s*\}\}/);
});

test("field errors and server errors are shown as returned, never a raw/rethrown error", () => {
  assert.match(source, /confirmState\.formError/);
  assert.match(source, /disputeState\.formError/);
  assert.match(source, /disputeState\.fieldErrors\?\.disputeReason/);
});

test("no optimistic local mutation of payout status before either action resolves", () => {
  assert.doesNotMatch(source, /useState\(.*CONFIRMED"\)/);
  assert.doesNotMatch(source, /useState\(.*DISPUTED"\)/);
  assert.doesNotMatch(source, /setConfirmState\(/);
  assert.doesNotMatch(source, /setDisputeState\(/);
});

test("no direct Prisma reference or platform-User (owner) identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireUser/);
  assert.doesNotMatch(source, /next-auth/);
});

test("no round/circle lifecycle mutation language exists anywhere in this component", () => {
  for (const forbidden of ["closeRound", "activateNextRound", "completeCircle", "round.status ="]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
