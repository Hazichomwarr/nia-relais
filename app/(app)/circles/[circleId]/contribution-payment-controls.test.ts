import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./contribution-payment-controls.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

test("this is a client component using the existing confirm/reject actions and their initial states", () => {
  assert.match(rawSource, /^"use client";/);
  assert.match(source, /useActionState\(\s*confirmContributionAction,\s*initialConfirmContributionState,?\s*\)/);
  assert.match(source, /useActionState\(\s*rejectContributionAction,\s*initialRejectContributionState,?\s*\)/);
});

test("the confirm form submits exactly circleId and paymentId", () => {
  const confirmFormStart = source.indexOf("<form action={confirmAction}>");
  const confirmFormEnd = source.indexOf("</form>", confirmFormStart);
  const confirmForm = source.slice(confirmFormStart, confirmFormEnd);
  const names = [...confirmForm.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ["circleId", "paymentId"]);
});

test("the reject form submits exactly circleId, paymentId, and rejectionReason", () => {
  const rejectFormStart = source.indexOf('<form action={rejectAction}');
  const rejectFormEnd = source.indexOf("</form>", rejectFormStart);
  const rejectForm = source.slice(rejectFormStart, rejectFormEnd);
  const names = [...rejectForm.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ["circleId", "paymentId", "rejectionReason"]);
});

test("no ownerId, memberId, roundId, currency, expectedAmount, or status field exists anywhere in either form", () => {
  for (const forbidden of [
    'name="ownerId"',
    'name="memberId"',
    'name="roundId"',
    'name="currency"',
    'name="expectedAmount"',
    'name="status"',
  ]) {
    assert.ok(!source.includes(forbidden), `expected no form field "${forbidden}"`);
  }
});

test("the confirmation copy clearly states NIA does not hold or transfer money, and to confirm only if actually received outside NIA", () => {
  assert.match(source, /Confirm only if this contribution was actually received outside NIA/);
  assert.match(source, /NIA does not hold or transfer money/);
});

test("the rejection reason textarea is required, and the submit button is also disabled until non-empty", () => {
  const textareaStart = source.indexOf("<textarea");
  const textareaEnd = source.indexOf("/>", textareaStart);
  const textarea = source.slice(textareaStart, textareaEnd);
  assert.match(textarea, /\brequired\b/);
  assert.match(textarea, /name="rejectionReason"/);
  assert.match(source, /disabled=\{anyPending \|\| rejectionReason\.trim\(\)\.length === 0\}/);
});

test("cancelling the reject flow performs no mutation -- a plain type=\"button\" that only resets local state", () => {
  const cancelTextIndex = source.indexOf(">Cancel<") !== -1 ? source.indexOf(">Cancel<") : source.indexOf("Cancel");
  const cancelButtonStart = source.lastIndexOf("<button", cancelTextIndex);
  const cancelButtonEnd = source.indexOf("</button>", cancelButtonStart);
  const cancelButtonSource = source.slice(cancelButtonStart, cancelButtonEnd);
  assert.match(cancelButtonSource, /type="button"/);
  assert.match(cancelButtonSource, /setShowRejectForm\(false\)/);
  assert.match(cancelButtonSource, /setRejectionReason\(""\)/);
  assert.doesNotMatch(cancelButtonSource, /rejectAction\(\)/);
});

test("confirm and reject controls only ever render for a RECORDED payment (enforced by the parent, not re-checked here) -- neither hardcodes a different status", () => {
  assert.doesNotMatch(source, /payment\.status/);
});

test("both confirm and reject buttons are disabled while either action is pending", () => {
  assert.match(source, /const anyPending = confirmPending \|\| rejectPending;/);
  assert.match(source, /disabled=\{anyPending\}[\s\S]*?Confirm received/);
});

test("no optimistic local mutation of payment status -- this component never sets its own CONFIRMED/REJECTED state", () => {
  assert.doesNotMatch(source, /useState\(.*CONFIRMED/);
  assert.doesNotMatch(source, /useState\(.*REJECTED/);
});

test("server errors from both actions are shown as returned", () => {
  assert.match(source, /confirmState\.formError/);
  assert.match(source, /rejectState\.formError/);
});

test("no raw actor id (recordedById/confirmedById/rejectedById) is ever referenced", () => {
  for (const forbidden of ["recordedById", "confirmedById", "rejectedById"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
});
