import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- circle-completion.actions.ts is a real
// "use server" module, kept thin and behaviorally tested only through its
// own core (complete-circle.ts), exactly mirroring
// round-lifecycle.actions.test.ts's own precedent.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./circle-completion.actions.ts", import.meta.url), "utf8"),
);

test("the file is a real Server Action module", () => {
  assert.match(source, /^"use server";/);
});

test("completeCircleAction delegates to runCompleteCircleAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function completeCircleAction\(/);
  assert.match(source, /runCompleteCircleAction\(formData\)/);
});

test("completeCircleAction revalidates both the owner AND member circle routes only after a genuine success", () => {
  assert.match(
    source,
    /export async function completeCircleAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)[\s\S]*?revalidatePath\(`\/member\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

test("no redirect of any kind -- this action is never wired to send the owner anywhere (the P1 owner-route gap remains 7L.3's job)", () => {
  assert.doesNotMatch(source, /redirect\(/);
  assert.ok(!source.includes("next/navigation"));
});

test("no inline Zod schema parsing and no direct circle-completion service import -- all validation/service calls stay in the core action module", () => {
  assert.ok(!source.includes("@/src/services/circle-completion.service"));
});

test("no direct identity-authority reference -- requireUser stays inside the core action module", () => {
  for (const forbidden of ["requireUser(", "requireCircleMember", "validateCircleMemberSession"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct Prisma/repository reference, and no raw SavingsCircle mutation reference", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of [
    "@/src/repositories/circle-completion.repository",
    "@/src/repositories/circle-lock.repository",
    "lockSavingsCircleForUpdate",
    "SavingsCircle.update",
    "completedAt:",
    "completedById:",
    "archivedAt",
    "archivedById",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no broad or unrelated revalidation", () => {
  assert.doesNotMatch(source, /revalidatePath\("\/"\)/);
  assert.doesNotMatch(source, /revalidateTag/);
});

test("no round-lifecycle/contribution/payout action reference of any kind -- this wrapper knows only about completion", () => {
  for (const forbidden of [
    "activateFirstRoundAction",
    "advanceRoundAction",
    "recordContributionAction",
    "recordPayoutAction",
    "round-lifecycle.actions",
    "payout.actions",
    "circle.actions",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
