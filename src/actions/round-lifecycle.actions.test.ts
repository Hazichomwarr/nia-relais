import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- round-lifecycle.actions.ts is a real
// "use server" module, kept thin and behaviorally tested only through its
// own cores (activate-first-round.ts / advance-round.ts), exactly
// mirroring payout.actions.test.ts's own precedent.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./round-lifecycle.actions.ts", import.meta.url), "utf8"),
);

test("the file is a real Server Action module", () => {
  assert.match(source, /^"use server";/);
});

// --- activateFirstRoundAction ---

test("activateFirstRoundAction delegates to runActivateFirstRoundAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function activateFirstRoundAction\(/);
  assert.match(source, /runActivateFirstRoundAction\(formData\)/);
});

test("activateFirstRoundAction revalidates both the owner AND member circle routes only after a genuine success", () => {
  assert.match(
    source,
    /export async function activateFirstRoundAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)[\s\S]*?revalidatePath\(`\/member\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- advanceRoundAction ---

test("advanceRoundAction delegates to runAdvanceRoundAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function advanceRoundAction\(/);
  assert.match(source, /runAdvanceRoundAction\(formData\)/);
});

test("advanceRoundAction revalidates both the owner AND member circle routes only after a genuine success", () => {
  assert.match(
    source,
    /export async function advanceRoundAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)[\s\S]*?revalidatePath\(`\/member\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- no duplicated domain validation, no direct service/identity imports ---

test("no inline Zod schema parsing and no direct round-lifecycle service import -- all validation/service calls stay in the core action modules", () => {
  assert.doesNotMatch(source, /advanceRoundSchema/);
  assert.ok(!source.includes("@/src/services/round-lifecycle.service"));
});

test("no direct identity-authority reference -- requireUser stays inside the core action modules", () => {
  for (const forbidden of ["requireUser", "requireCircleMember", "validateCircleMemberSession"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct Prisma/repository reference, and no raw PayoutRound/SavingsCircle mutation reference", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of [
    "@/src/repositories/round-lifecycle.repository",
    "@/src/repositories/circle-lock.repository",
    "lockSavingsCircleForUpdate",
    "PayoutRound.update",
    "SavingsCircle.update",
    "completedAt",
    "completedById",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no broad or unrelated revalidation", () => {
  assert.doesNotMatch(source, /revalidatePath\("\/"\)/);
  assert.doesNotMatch(source, /revalidateTag/);
});

test("no circle-completion service reference of any kind", () => {
  for (const forbidden of ["completeCircle", "CircleCompletion", "circle-completion"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
