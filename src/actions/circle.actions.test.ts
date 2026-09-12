import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- circle.actions.ts statically imports
// next/navigation's redirect() and is therefore not safe to import/execute
// directly under the plain Node test harness (see create-draft-circle.ts's
// own comment on why that import is deferred there). All real behavior is
// delegated to runCreateDraftCircleAction / runAddDraftCircleMemberAction /
// runRemoveDraftCircleMemberAction / runSetDraftCirclePayoutOrderAction,
// each fully behaviorally tested in its own test file. This mirrors the
// route.ts/page.tsx structural-test pattern used throughout this ticket
// sequence.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./circle.actions.ts", import.meta.url), "utf8"),
);

test("the file is a real Server Action module", () => {
  assert.match(source, /^"use server";/);
});

// --- createDraftCircleAction ---

test("createDraftCircleAction delegates to runCreateDraftCircleAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /runCreateDraftCircleAction\(formData\)/);
});

test("on success, createDraftCircleAction redirects to /circles/<the outcome's own circleId>, not a hardcoded or different field", () => {
  assert.match(source, /redirect\(\s*`\/circles\/\$\{encodeURIComponent\(outcome\.circleId\)\}`\s*\)/);
});

test("a failed create outcome returns its own state instead of redirecting", () => {
  assert.match(source, /if \(!outcome\.ok\) return outcome\.state;/);
});

// --- addDraftCircleMemberAction ---

test("addDraftCircleMemberAction delegates to runAddDraftCircleMemberAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function addDraftCircleMemberAction\(/);
  assert.match(source, /return runAddDraftCircleMemberAction\(formData\);/);
});

// --- removeDraftCircleMemberAction ---

test("removeDraftCircleMemberAction takes a single FormData argument (plain progressive-enhancement form binding, not useActionState)", () => {
  assert.match(source, /export async function removeDraftCircleMemberAction\(\s*formData: FormData,?\s*\): Promise<void>/);
});

test("removeDraftCircleMemberAction delegates to runRemoveDraftCircleMemberAction and revalidates only on genuine success", () => {
  assert.match(source, /runRemoveDraftCircleMemberAction\(formData\)/);
  assert.match(source, /if \(outcome\.ok[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(outcome\.circleId\)\}`\)/);
});

// --- setDraftCirclePayoutOrderAction ---

test("setDraftCirclePayoutOrderAction delegates to runSetDraftCirclePayoutOrderAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function setDraftCirclePayoutOrderAction\(/);
  assert.match(source, /runSetDraftCirclePayoutOrderAction\(formData\)/);
});

test("setDraftCirclePayoutOrderAction revalidates only after a genuine success", () => {
  assert.match(source, /if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/);
});

// --- activateCircleAction ---

test("activateCircleAction delegates to runActivateCircleAction rather than reimplementing the staleness check/service call", () => {
  assert.match(source, /export async function activateCircleAction\(/);
  assert.match(source, /runActivateCircleAction\(formData\)/);
});

test("on success, activateCircleAction revalidates then redirects to /circles/<the outcome's own circleId>", () => {
  assert.match(source, /if \(!outcome\.ok\) return outcome\.state;\s*\n\s*revalidatePath\(`\/circles\/\$\{encodeURIComponent\(outcome\.circleId\)\}`\);\s*\n\s*redirect\(`\/circles\/\$\{encodeURIComponent\(outcome\.circleId\)\}`\);/);
});

// --- recordContributionAction ---

test("recordContributionAction delegates to runRecordContributionAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function recordContributionAction\(/);
  assert.match(source, /runRecordContributionAction\(formData\)/);
});

test("recordContributionAction revalidates the circle summary route only after a genuine success", () => {
  assert.match(
    source,
    /export async function recordContributionAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- confirmContributionAction ---

test("confirmContributionAction delegates to runConfirmContributionAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function confirmContributionAction\(/);
  assert.match(source, /runConfirmContributionAction\(formData\)/);
});

test("confirmContributionAction revalidates the circle summary route only after a genuine success", () => {
  assert.match(
    source,
    /export async function confirmContributionAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- rejectContributionAction ---

test("rejectContributionAction delegates to runRejectContributionAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /export async function rejectContributionAction\(/);
  assert.match(source, /runRejectContributionAction\(formData\)/);
});

test("rejectContributionAction revalidates the circle summary route only after a genuine success", () => {
  assert.match(
    source,
    /export async function rejectContributionAction\([\s\S]*?if \(outcome\.status === "success"[\s\S]*?revalidatePath\(`\/circles\/\$\{encodeURIComponent\(circleId\)\}`\)/,
  );
});

// --- no duplicated domain validation anywhere in this thin wrapper file ---

test("no inline Zod schema parsing or direct circle.service import -- all validation stays in the core action modules", () => {
  assert.doesNotMatch(source, /createDraftCircleSchema/);
  assert.doesNotMatch(source, /addDraftCircleMemberSchema/);
  assert.doesNotMatch(source, /setDraftCirclePayoutOrderSchema/);
  assert.doesNotMatch(source, /from ["']@\/src\/services\/circle\.service["']/);
});

// --- no member/session identity dependency ---

test("no reference to the member-session identity system or platform Auth.js internals beyond next/navigation", () => {
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session", "next-auth"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

// --- no domain mutation outside the wired-up actions, and no direct
// financial (payment/payout) service reference -- only the testable-core
// action modules (which themselves own the service import) may be
// imported here ---

test("no direct Prisma reference, and no raw ContributionPayment/Payout mutation reference", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of ["ContributionPayment", "Payout.create", "recordPayout"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("contribution services are never imported directly -- only the run*ContributionAction core modules are", () => {
  for (const forbidden of [
    "@/src/services/contribution-recording.service",
    "@/src/services/contribution-confirmation.service",
    "@/src/services/contribution-rejection.service",
  ]) {
    assert.ok(!source.includes(forbidden), `expected no direct import of "${forbidden}"`);
  }
  assert.doesNotMatch(source, /recordContributionSchema|confirmContributionSchema|rejectContributionSchema/);
});

// --- type-vs-runtime export regression guard (superseded by a hotfix) ---
//
// SUPERSEDED: this test previously asserted that a single barrel
// `export type { ... };` block re-exporting every *ActionState type was
// the correct, safe shape for this file. It was wrong. That block was
// syntactically type-only (tsc erases it completely, and the assertions
// below correctly proved that), but Next.js/Turbopack's "use server"
// action-reference collector does not check the `type` keyword on a
// specifier-list re-export -- it swept every name in that block into the
// action-entry manifest and emitted `registerServerReference(<Name>, ...)`
// for each, producing `ReferenceError: <Name> is not defined` at
// module-evaluation time in the real compiled dev bundle (confirmed
// against actual `.next/dev/server/chunks/ssr/*.js` output, reproduced on
// POST /circles/new). This was a genuine, real production-shaped
// failure that a purely syntactic/type-checker-level test like the one
// this replaces could never catch, because the bug lives in the bundler
// transform, not in TypeScript's own erasure rules.
//
// The actual fix: the barrel `export type { ... };` block was removed
// entirely (see circle.actions.ts's own comment). Each *ActionState type
// is now imported directly from its own owning core module
// (activate-circle.ts, add-draft-circle-member.ts, ...) by whichever
// state/UI file needs it -- never re-exported through this "use server"
// file at all. This test now asserts that corrected shape; the systemic,
// codebase-wide version of this guard (covering every "use server" file,
// not just this one) lives in use-server-export-shape.test.ts.
test("no barrel type re-export exists in this file -- every *ActionState type is imported directly from its own owning core module elsewhere", () => {
  assert.doesNotMatch(source, /export\s+type\s*\{/, "a type re-export specifier list here reproduces the ReferenceError this hotfix fixed");

  // Each *ActionState symbol is still imported here (needed as a
  // parameter/return type for this file's own exported async functions)
  // with the `type` modifier -- this half of the original test remains
  // valid and worth keeping, even though it is not sufficient on its own
  // (see the module-level comment above for why).
  const stateTypeNames = [
    "ActivateCircleActionState",
    "AddDraftCircleMemberActionState",
    "ConfirmContributionActionState",
    "CreateDraftCircleActionState",
    "RecordContributionActionState",
    "RejectContributionActionState",
    "SetDraftCirclePayoutOrderActionState",
  ];
  for (const name of stateTypeNames) {
    const typedImport = new RegExp(`(?:import[\\s\\S]*?\\btype ${name}\\b|import type[\\s\\S]*?\\b${name}\\b)`);
    assert.match(source, typedImport, `expected ${name} to be imported with the \`type\` modifier`);
  }
});
