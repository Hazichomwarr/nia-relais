import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural guard for 7K.14: this ticket ships no UI whatsoever. Every
// existing owner/member circle-page component must remain completely
// unaware of the new round-lifecycle action identifiers -- if any of
// these files ever references activateFirstRoundAction/advanceRoundAction
// (or their state/initial-state exports), that is a sign a future ticket
// wired UI to this action without updating this guard, not a sign this
// guard is stale.

const UI_FILES = [
  "app/(app)/circles/[circleId]/page.tsx",
  "app/(app)/circles/[circleId]/active-circle-summary.tsx",
  "app/(app)/circles/[circleId]/contribution-desk.tsx",
  "app/(app)/circles/[circleId]/payout-desk.tsx",
  "app/member/circles/[circleId]/page.tsx",
  "app/member/circles/[circleId]/member-dashboard.tsx",
  "app/member/circles/[circleId]/member-payout-card.tsx",
];

const FORBIDDEN_IDENTIFIERS = [
  "activateFirstRoundAction",
  "advanceRoundAction",
  "runActivateFirstRoundAction",
  "runAdvanceRoundAction",
  "initialActivateFirstRoundState",
  "initialAdvanceRoundState",
  "round-lifecycle.actions",
  "round-lifecycle.state",
];

for (const relativePath of UI_FILES) {
  test(`${relativePath} does not reference any round-lifecycle action identifier`, () => {
    const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      assert.ok(!source.includes(identifier), `expected no reference to "${identifier}" in ${relativePath}`);
    }
  });
}
