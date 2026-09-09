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
  readFileSync(new URL("./payout-order-form.tsx", import.meta.url), "utf8"),
);

test("uses the existing action and its initial state, not a new action framework", () => {
  assert.match(source, /useActionState\(\s*setDraftCirclePayoutOrderAction,\s*initialSetDraftCirclePayoutOrderState,?\s*\)/);
});

// K. ACTIVE members only in UI / L. REMOVED members excluded
test("K/L. the editable order is built only from ACTIVE members -- REMOVED members are filtered out first", () => {
  assert.match(source, /members\.filter\(\(member\) => member\.status === "ACTIVE"\)/);
});

// M. initial persisted payoutOrder respected / N. unsaved cohort gets deterministic initial order
test("M/N. the initial local order comes directly from the already-correctly-ordered activeMembers array -- no re-sort is duplicated here", () => {
  assert.match(source, /useState<readonly DraftCircleOwnerMemberResult\[\]>\(activeMembers\)/);
  assert.doesNotMatch(source, /\.sort\(/);
});

// O. move-up behavior / P. move-down behavior
test("O/P. moveUp and moveDown swap adjacent members in local state only", () => {
  assert.match(source, /function moveUp\(index: number\)/);
  assert.match(source, /function moveDown\(index: number\)/);
  assert.match(source, /setOrder\(\(current\) => \{/);
});

// Q. first member cannot move up / R. last member cannot move down
test("Q/R. the first row's Move up and the last row's Move down are disabled", () => {
  assert.match(source, /disabled=\{index === 0\}/);
  assert.match(source, /disabled=\{index === order\.length - 1\}/);
});

// S. local movement does not mutate server
test("S. moveUp/moveDown never call the action or fetch -- only setOrder", () => {
  const moveUpBody = source.match(/function moveUp[\s\S]*?\n  \}/)?.[0] ?? "";
  const moveDownBody = source.match(/function moveDown[\s\S]*?\n  \}/)?.[0] ?? "";
  for (const body of [moveUpBody, moveDownBody]) {
    assert.doesNotMatch(body, /formAction/);
    assert.doesNotMatch(body, /fetch\(/);
    assert.doesNotMatch(body, /setDraftCirclePayoutOrderAction/);
  }
});

// T. save submits complete ordered sequence
test("T. the save form submits circleId plus one memberId hidden input per member, in the current local order", () => {
  assert.match(source, /order\.map\(\(member\) => \(\s*<input key=\{member\.id\} type="hidden" name="memberId" value=\{member\.id\} \/>/);
  assert.match(source, /<input type="hidden" name="circleId" value=\{circleId\} \/>/);
});

test("no payoutOrder numeric value or ownerId is ever submitted from the client", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(nameAttributes)].sort(), ["circleId", "memberId"]);
});

// W. memberCode may display, PIN never displays
test("W. memberCode is shown for disambiguation, but no PIN field is ever rendered", () => {
  assert.match(source, /member\.memberCode/);
  assert.doesNotMatch(source, /\bpin\b/i);
  assert.doesNotMatch(source, /pinHash/);
});

// X. no drag-and-drop dependency
test("X. no drag-and-drop library or HTML5 drag API is used", () => {
  for (const forbidden of ["react-dnd", "dnd-kit", "sortablejs", "draggable=", "onDragStart", "onDrop"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("prevents duplicate save submissions while the action is pending", () => {
  assert.match(source, /type="submit"[\s\S]*?disabled=\{pending\}/);
});

test("shows an unsaved/saved indicator derived at render time -- no setState-in-effect pattern", () => {
  assert.match(source, /isSaved/);
  assert.match(source, /persistedPayoutOrderFor\(member\) === index \+ 1/);
  assert.doesNotMatch(source, /useEffect/);
});

test("shows a note that at least 2 active members are required for activation, without blocking saving below that count", () => {
  assert.match(source, /activeMembers\.length < 2/);
  assert.match(source, /At least 2 active members are required before the circle can be activated\./);
  // The save button itself is never conditionally hidden/disabled based on
  // member count -- only on `pending` -- matching the domain service's own
  // contract (min length 1), not a UI-invented stricter rule.
  assert.doesNotMatch(source, /disabled=\{activeMembers\.length/);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /nia_member_session/);
});

// Z. no financial/lifecycle mutation
test("Z. no reference to rounds, obligations, payouts, or activation anywhere in this component", () => {
  for (const forbidden of ["PayoutRound", "ContributionObligation", "activateCircle", "Payout.create"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
