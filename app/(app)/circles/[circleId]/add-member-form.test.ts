import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source -- no DOM/React
// render is exercised (no new testing-library/jsdom dependency for this
// ticket, matching every other UI ticket in this sequence).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./add-member-form.tsx", import.meta.url), "utf8"),
);

test("uses the existing action and its initial state, not a new action framework", () => {
  assert.match(source, /useActionState\(addDraftCircleMemberAction, initialAddDraftCircleMemberState\)/);
});

test("submits exactly circleId, displayName, email, and pin -- nothing else", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["circleId", "displayName", "email", "pin"]);
});

test("no ownerId, status, userId, or provenance field exists anywhere in the form", () => {
  for (const forbidden of ["ownerId", "userId", "activatedAt", "payoutOrder", "name=\"status\""]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

// immediate handoff uses the submitted PIN
test("the handoff captures the exact PIN value submitted, via a ref set at submit time -- not re-read from server state", () => {
  assert.match(source, /lastSubmittedPinRef\.current = pin;/);
  assert.match(source, /pin: lastSubmittedPinRef\.current/);
  // The server's own success payload has no pin field to read from --
  // only id/displayName/memberCode.
  assert.doesNotMatch(source, /state\.member\.pin/);
});

// no browser storage or URL persistence of PIN
test("the PIN is never written to localStorage, sessionStorage, or any URL", () => {
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /router\.push/);
  assert.doesNotMatch(source, /window\.location/);
  assert.doesNotMatch(source, /searchParams/);
});

test("the PIN is never logged or sent anywhere but the form action", () => {
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /fetch\(/);
});

// handoff cleared on dismissal/navigation/reload
test("dismissing the handoff clears it via plain component state, with no persistence to survive a reload", () => {
  assert.match(source, /onClick=\{\(\) => setHandoff\(null\)\}/);
  // useState (not a ref keyed to storage, not a URL param) is the only
  // thing holding the handoff -- unmounting (navigation) or reloading the
  // page discards it automatically because nothing here persists it.
  assert.match(source, /useState<HandoffMember \| null>\(null\)/);
});

// no "reveal PIN again" feature
test("there is no second control that could re-show a PIN after the handoff is dismissed", () => {
  const revealButtons = [...source.matchAll(/<button[^>]*>/g)];
  assert.equal(revealButtons.length, 2, "expected exactly the submit button and the one dismiss button");
});

test("prevents duplicate submissions while the action is pending", () => {
  assert.match(source, /type="submit"[\s\S]*?disabled=\{pending\}/);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
});
