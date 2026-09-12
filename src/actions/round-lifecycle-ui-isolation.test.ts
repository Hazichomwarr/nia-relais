import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Structural guard, originally 7K.14 ("this ticket ships no UI
// whatsoever"), now updated for 7K.16 ("this ticket wires the owner side
// only"). Two separate boundaries are checked:
//
// 1. OWNER files untouched by 7K.16 (active-circle-summary.tsx,
//    contribution-desk.tsx, payout-desk.tsx) and page.tsx itself must
//    never reference the raw round-lifecycle ACTION identifiers
//    directly -- only round-lifecycle-controls.tsx (7K.16, deliberately
//    not in this list) ever calls activateFirstRoundAction/
//    advanceRoundAction; page.tsx only ever imports the READ model
//    (getOwnerRoundLifecycle) and the <RoundLifecycleCard> component, and
//    round-lifecycle-card.tsx itself never imports the raw actions either
//    (it imports the two control components, exactly like
//    contribution-desk.tsx imports ContributionPaymentControls without
//    importing confirmContributionAction directly).
//
// 2. MEMBER files must never reference the round-lifecycle action
//    identifiers OR the owner-only lifecycle UI (RoundLifecycleCard, its
//    controls, or their CTA copy) -- members retain existing read-only
//    round visibility and payout confirm/dispute authority only. No
//    lifecycle mutation form/action/control of any kind may ever reach
//    the member route tree.

const ACTION_IDENTIFIERS = [
  "activateFirstRoundAction",
  "advanceRoundAction",
  "runActivateFirstRoundAction",
  "runAdvanceRoundAction",
  "initialActivateFirstRoundState",
  "initialAdvanceRoundState",
  "round-lifecycle.actions",
  "round-lifecycle.state",
];

const OWNER_FILES_NEVER_REFERENCING_ACTIONS_DIRECTLY = [
  "app/(app)/circles/[circleId]/page.tsx",
  "app/(app)/circles/[circleId]/active-circle-summary.tsx",
  "app/(app)/circles/[circleId]/contribution-desk.tsx",
  "app/(app)/circles/[circleId]/payout-desk.tsx",
  "app/(app)/circles/[circleId]/round-lifecycle-card.tsx",
];

for (const relativePath of OWNER_FILES_NEVER_REFERENCING_ACTIONS_DIRECTLY) {
  test(`${relativePath} does not reference the round-lifecycle action identifiers directly`, () => {
    const source = stripComments(readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"));
    for (const identifier of ACTION_IDENTIFIERS) {
      assert.ok(!source.includes(identifier), `expected no reference to "${identifier}" in ${relativePath}`);
    }
  });
}

const MEMBER_FILES = [
  "app/member/circles/[circleId]/page.tsx",
  "app/member/circles/[circleId]/member-dashboard.tsx",
  "app/member/circles/[circleId]/member-payout-card.tsx",
];

const MEMBER_FORBIDDEN_IDENTIFIERS = [
  ...ACTION_IDENTIFIERS,
  "RoundLifecycleCard",
  "StartFirstRoundForm",
  "AdvanceRoundForm",
  "round-lifecycle-card",
  "round-lifecycle-controls",
  "round-lifecycle-display",
  "Start round 1",
  "Close final round",
  "Close round",
];

for (const relativePath of MEMBER_FILES) {
  test(`${relativePath} does not reference any round-lifecycle mutation identifier or the owner-only lifecycle UI`, () => {
    const source = stripComments(readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"));
    for (const identifier of MEMBER_FORBIDDEN_IDENTIFIERS) {
      assert.ok(!source.includes(identifier), `expected no reference to "${identifier}" in ${relativePath}`);
    }
  });
}
