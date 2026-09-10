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

// --- type-vs-runtime export regression guard (hotfix) ---
//
// Every *ActionState type this file imports and re-exports is a
// type-only construct declared in its own core action module (e.g.
// ActivateCircleActionState in activate-circle.ts) -- never a runtime
// value. If a future edit ever drops the `type` modifier from either the
// per-symbol import (line ~8) or the barrel `export type { ... }` block
// below, Next's Server Actions module loader would try to resolve an
// erased symbol at module-evaluation time and crash with a
// ReferenceError ("<Name> is not defined") the instant any route that
// imports this file (e.g. /circles/new, via circle.state.ts) loads --
// this is exactly the failure class TypeScript's own type-checker does
// NOT catch, since `import { X }` and `import type { X }` are both
// perfectly valid syntax to tsc when X really is only ever used in type
// position; the crash is a pure module-evaluation/erasure issue, not a
// type error.
test("every re-exported *ActionState symbol is imported and re-exported as a TYPE, never a runtime value", () => {
  const stateTypeNames = [
    "ActivateCircleActionState",
    "AddDraftCircleMemberActionState",
    "ConfirmContributionActionState",
    "CreateDraftCircleActionState",
    "RecordContributionActionState",
    "RejectContributionActionState",
    "SetDraftCirclePayoutOrderActionState",
  ];

  // The barrel re-export must be a single `export type { ... }` block
  // (fully erased at runtime), never a bare `export { ... }`.
  const exportTypeBlockMatch = source.match(/export type \{([\s\S]*?)\};/);
  assert.ok(exportTypeBlockMatch, "expected a single `export type { ... };` block");
  const exportedNames = exportTypeBlockMatch[1].split(",").map((name) => name.trim()).filter(Boolean);
  assert.deepEqual(exportedNames.sort(), [...stateTypeNames].sort());

  // No OTHER export statement anywhere in the file may re-export any of
  // these names as a runtime value (e.g. a stray `export { X }` outside
  // the type-only block above).
  for (const name of stateTypeNames) {
    const strayValueExport = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}(?!\\s*from)`);
    const exportTypeStripped = source.replace(/export type \{[\s\S]*?\};/, "");
    assert.doesNotMatch(exportTypeStripped, strayValueExport, `expected no stray runtime export of ${name}`);
  }

  // Each *ActionState symbol must be imported with the `type` modifier
  // (either `import { ..., type X, ... }` or a dedicated `import type`),
  // never as a plain runtime import.
  for (const name of stateTypeNames) {
    const typedImport = new RegExp(`(?:import type[\\s\\S]*?\\b${name}\\b|type ${name}\\b)`);
    assert.match(source, typedImport, `expected ${name} to be imported with the \`type\` modifier`);

    // And it must never appear as a plain (non-type) named import specifier.
    const plainImport = new RegExp(`import \\{[^}]*(?<!type )\\b${name}\\b[^}]*\\}\\s*from`);
    const matches = source.match(plainImport);
    if (matches) {
      assert.ok(matches[0].includes(`type ${name}`), `expected ${name}'s import specifier to carry \`type\`, got: ${matches[0]}`);
    }
  }
});
