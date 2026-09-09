import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual form source -- no DOM/React render is
// exercised (no new testing-library/jsdom dependency for this ticket,
// matching every other UI ticket in this sequence). Pure logic (the
// contribution restatement, frequency labels) is covered behaviorally in
// new-circle-form-display.test.ts.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readHere(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const formSource = stripComments(readHere("./new-circle-form.tsx"));
const pageSource = stripComments(readHere("./page.tsx"));

test("the form uses the existing action and its initial state, not a new action framework", () => {
  assert.match(formSource, /useActionState\(createDraftCircleAction, initialCreateDraftCircleState\)/);
  assert.match(formSource, /from ["']@\/src\/actions\/circle\.actions["']/);
  assert.match(formSource, /from ["']@\/src\/actions\/circle\.state["']/);
});

test("the form submits exactly the five expected fields, nothing else", () => {
  const nameAttributes = [...formSource.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), [
    "contributionAmount",
    "currency",
    "frequency",
    "name",
    "startDate",
  ]);
});

test("no ownerId, status, activation, or memberId field exists anywhere in the form", () => {
  for (const forbidden of ["ownerId", "activatedAt", "activatedById", "memberId", "name=\"status\""]) {
    assert.ok(!formSource.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("currency and frequency options come from the schema's exported constants, not a duplicated list", () => {
  assert.match(formSource, /DRAFT_CIRCLE_CURRENCIES\.map/);
  assert.match(formSource, /DRAFT_CIRCLE_FREQUENCIES\.map/);
  assert.match(formSource, /from ["']@\/src\/validations\/circle\.schema["']/);
});

test("the submit button is disabled while the action is pending, preventing duplicate submissions", () => {
  assert.match(formSource, /type="submit"[\s\S]*?disabled=\{pending\}/);
});

test("field errors are rendered per field, and a safe form-level error has its own render path", () => {
  assert.match(formSource, /state\.fieldErrors\?\.name/);
  assert.match(formSource, /state\.fieldErrors\?\.currency/);
  assert.match(formSource, /state\.fieldErrors\?\.contributionAmount/);
  assert.match(formSource, /state\.fieldErrors\?\.frequency/);
  assert.match(formSource, /state\.fieldErrors\?\.startDate/);
  assert.match(formSource, /state\.formError/);
});

test("no round-schedule preview is computed here -- member count and payout order aren't known yet", () => {
  for (const source of [formSource]) {
    assert.doesNotMatch(source, /roundNumber/);
    assert.doesNotMatch(source, /payoutOrder/);
    assert.doesNotMatch(source, /dueDate/);
  }
});

test("no direct Prisma reference or member-session identity import anywhere in this route's new files", () => {
  for (const source of [formSource, pageSource]) {
    assert.doesNotMatch(source, /prisma\./);
    assert.doesNotMatch(source, /requireCircleMember/);
    assert.doesNotMatch(source, /validateCircleMemberSession/);
    assert.doesNotMatch(source, /nia_member_session/);
  }
});

test("no financial mutation call (create/update/delete) exists in this route's new files", () => {
  for (const source of [formSource, pageSource]) {
    assert.doesNotMatch(source, /\.create\(/);
    assert.doesNotMatch(source, /\.update\(/);
    assert.doesNotMatch(source, /\.delete\(/);
  }
});
