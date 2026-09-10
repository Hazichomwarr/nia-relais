import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- payout.actions.ts is a real "use server"
// module, kept thin and behaviorally tested only through its own core
// (record-payout.ts / confirm-payout.ts / dispute-payout.ts), exactly
// mirroring circle.actions.test.ts's own precedent for the contribution
// action wrappers.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(readFileSync(new URL("./payout.actions.ts", import.meta.url), "utf8"));

test("the file is a real Server Action module", () => {
  assert.match(source, /^"use server";/);
});

// --- recordPayoutAction ---

test("recordPayoutAction delegates to runRecordPayoutAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function recordPayoutAction\(/);
  assert.match(source, /runRecordPayoutAction\(formData\)/);
});

test("recordPayoutAction revalidates the owner circle route only after a genuine success", () => {
  assert.match(
    source,
    /export async function recordPayoutAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- confirmPayoutAction ---

test("confirmPayoutAction delegates to runConfirmPayoutAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function confirmPayoutAction\(/);
  assert.match(source, /runConfirmPayoutAction\(formData\)/);
});

test("confirmPayoutAction revalidates the MEMBER circle route (not the owner one) only after a genuine success", () => {
  assert.match(
    source,
    /export async function confirmPayoutAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/member\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- disputePayoutAction ---

test("disputePayoutAction delegates to runDisputePayoutAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function disputePayoutAction\(/);
  assert.match(source, /runDisputePayoutAction\(formData\)/);
});

test("disputePayoutAction revalidates the MEMBER circle route (not the owner one) only after a genuine success", () => {
  assert.match(
    source,
    /export async function disputePayoutAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/member\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- no duplicated domain validation, no direct service/identity imports ---

test("no inline Zod schema parsing and no direct payout service import -- all validation/service calls stay in the core action modules", () => {
  assert.doesNotMatch(source, /recordPayoutSchema|confirmPayoutSchema|disputePayoutSchema/);
  for (const forbidden of [
    "@/src/services/payout-recording.service",
    "@/src/services/payout-confirmation.service",
    "@/src/services/payout-dispute.service",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no direct import of "${forbidden}"`);
  }
});

test("no direct identity-authority reference -- requireUser/requireCircleMember stay inside the core action modules", () => {
  for (const forbidden of ["requireUser", "requireCircleMember", "validateCircleMemberSession"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct Prisma reference, and no raw Payout mutation reference", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of ["Payout.create", "Payout.update", "lockSavingsCircleForUpdate"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no broad or unrelated revalidation", () => {
  assert.doesNotMatch(source, /revalidatePath\("\/"\)/);
  assert.doesNotMatch(source, /revalidateTag/);
});
