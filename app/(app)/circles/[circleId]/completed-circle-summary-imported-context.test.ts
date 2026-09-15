import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 9G: same rationale as active-circle-summary-imported-context.test.ts --
// completed-circle-summary.test.ts's own literal-string assertions predate
// this ticket and predate an unrelated, pre-existing, uncommitted
// localization pass; fixing that drift is out of scope here. This file
// verifies only what 9G itself added to this component: the circle-level
// imported-history banner (this summary has no round schedule to badge --
// getCompletedCircleSummaryForOwner deliberately carries none, per its own
// module comment, so there is nothing else for 9G to touch here).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./completed-circle-summary.tsx", import.meta.url), "utf8"),
);

test("renders the circle-level imported-history banner only when circle.originKind is IMPORTED", () => {
  assert.match(source, /circle\.originKind === "IMPORTED"/);
  assert.match(source, /copy\.importedCircleContextTitle/);
  assert.match(source, /copy\.importedCircleContextDescription/);
  assert.match(source, /circle\.historicalCompletedRoundCount/);
});

test("no new mutation control was introduced by this banner (still no <button>, no <form>)", () => {
  assert.doesNotMatch(source, /<button/i);
  assert.doesNotMatch(source, /<form/i);
});
