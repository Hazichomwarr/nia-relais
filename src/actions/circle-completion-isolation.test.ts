import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural guard, originally 7L.2 ("this ticket ships no UI"), updated
// for 7L.3 ("the completion CTA now lives in exactly one place"). Three
// boundaries are checked:
//
// 1. page.tsx and round-lifecycle-card.tsx are DELIBERATELY REMOVED from
//    the forbidden list below (7L.3): page.tsx now branches on circle
//    status and renders a COMPLETED historical workspace, and
//    round-lifecycle-card.tsx now renders CompleteCircleForm inside its
//    own ALL_ROUNDS_CLOSED phase -- both are checked positively (that they
//    DO reference completion, in the right shape) by page.test.ts and
//    round-lifecycle-card.test.ts instead, not here.
//
// 2. Every OTHER existing owner/member circle UI file (source only, not
//    its own tests) must still never reference any completion identifier
//    -- active-circle-summary.tsx, contribution-desk.tsx, payout-desk.tsx,
//    round-lifecycle-controls.tsx, round-lifecycle-display.ts, the
//    contribution/payout form controls, and every member file. The
//    completion CTA's own authority (phase === "ALL_ROUNDS_CLOSED") stays
//    confined to round-lifecycle-card.tsx alone -- no sibling component
//    reconstructs it or gains its own completion reference.
//
// 3. Every existing Server Action module in this directory (other than
//    circle-completion.actions.ts/complete-circle.ts themselves) must
//    never reference circle completion -- no automatic completion wiring
//    from advanceRound, no completion authority smuggled into the
//    draft/contribution/payout action files.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const COMPLETION_IDENTIFIERS = [
  "completeCircleAction",
  "runCompleteCircleAction",
  "initialCompleteCircleState",
  "circle-completion.actions",
  "circle-completion.state",
  "circle-completion.repository",
  "CircleCompletionResult",
  "completeCircle(",
  "CircleCompletion",
];

const OWNER_UI_SOURCE_FILES_STILL_FORBIDDEN = [
  "app/(app)/circles/[circleId]/active-circle-summary.tsx",
  "app/(app)/circles/[circleId]/contribution-desk.tsx",
  "app/(app)/circles/[circleId]/payout-desk.tsx",
  "app/(app)/circles/[circleId]/round-lifecycle-controls.tsx",
  "app/(app)/circles/[circleId]/round-lifecycle-display.ts",
  "app/(app)/circles/[circleId]/contribution-payment-controls.tsx",
  "app/(app)/circles/[circleId]/record-payout-form.tsx",
  "app/(app)/circles/[circleId]/record-contribution-form.tsx",
  "app/(app)/circles/[circleId]/completed-circle-summary.tsx",
];

const MEMBER_UI_SOURCE_FILES = [
  "app/member/circles/[circleId]/page.tsx",
  "app/member/circles/[circleId]/member-dashboard.tsx",
  "app/member/circles/[circleId]/member-payout-card.tsx",
  "app/member/circles/[circleId]/member-payout-controls.tsx",
];

for (const relativePath of [...OWNER_UI_SOURCE_FILES_STILL_FORBIDDEN, ...MEMBER_UI_SOURCE_FILES]) {
  test(`${relativePath} does not reference any circle-completion identifier`, () => {
    const source = stripComments(readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"));
    for (const identifier of COMPLETION_IDENTIFIERS) {
      assert.ok(!source.includes(identifier), `expected no reference to "${identifier}" in ${relativePath}`);
    }
  });
}

test("the completion control itself (complete-circle-controls.tsx) is never imported from any file other than round-lifecycle-card.tsx", () => {
  const candidates = [
    "app/(app)/circles/[circleId]/page.tsx",
    "app/(app)/circles/[circleId]/active-circle-summary.tsx",
    "app/(app)/circles/[circleId]/completed-circle-summary.tsx",
    "app/(app)/circles/[circleId]/contribution-desk.tsx",
    "app/(app)/circles/[circleId]/payout-desk.tsx",
    "app/(app)/circles/[circleId]/round-lifecycle-controls.tsx",
    ...MEMBER_UI_SOURCE_FILES,
  ];
  for (const relativePath of candidates) {
    const source = stripComments(readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"));
    assert.ok(!source.includes("complete-circle-controls"), `expected no reference to "complete-circle-controls" in ${relativePath}`);
    assert.ok(!source.includes("CompleteCircleForm"), `expected no reference to "CompleteCircleForm" in ${relativePath}`);
  }
});

const OTHER_ACTION_FILES = [
  "activate-circle.ts",
  "activate-first-round.ts",
  "advance-round.ts",
  "add-draft-circle-member.ts",
  "circle.actions.ts",
  "confirm-contribution.ts",
  "confirm-payout.ts",
  "create-draft-circle.ts",
  "dispute-payout.ts",
  "payout.actions.ts",
  "record-contribution.ts",
  "record-payout.ts",
  "reject-contribution.ts",
  "remove-draft-circle-member.ts",
  "round-lifecycle.actions.ts",
  "set-draft-circle-payout-order.ts",
];

for (const relativePath of OTHER_ACTION_FILES) {
  test(`${relativePath} does not reference circle completion of any kind -- no automatic/cross-domain wiring`, () => {
    const source = stripComments(readFileSync(new URL(`./${relativePath}`, import.meta.url), "utf8"));
    for (const identifier of COMPLETION_IDENTIFIERS) {
      assert.ok(!source.includes(identifier), `expected no reference to "${identifier}" in ${relativePath}`);
    }
  });
}

test("round-lifecycle.service.ts (the only writer of PayoutRound.status) never references circle completion -- advanceRound cannot chain into it", () => {
  const source = stripComments(readFileSync(new URL("../services/round-lifecycle.service.ts", import.meta.url), "utf8"));
  for (const identifier of COMPLETION_IDENTIFIERS) {
    assert.ok(!source.includes(identifier), `expected no reference to "${identifier}" in round-lifecycle.service.ts`);
  }
});

test("this ticket adds no archive action -- no archive-related identifier appears in either new action file", () => {
  for (const file of ["complete-circle.ts", "circle-completion.actions.ts", "circle-completion.state.ts"]) {
    const source = stripComments(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
    assert.doesNotMatch(source, /archive/i);
  }
});
