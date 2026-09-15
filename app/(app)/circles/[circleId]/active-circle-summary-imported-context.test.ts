import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 9G: a deliberately new, narrowly-scoped file rather than added assertions
// inside active-circle-summary.test.ts. That file's own literal-string
// assertions (e.g. />\s*ACTIVE\s*</, "No round is currently active.") were
// already failing before any 9G edit landed here -- this component was
// already converted to read every label from `dictionary`/`copy` by an
// unrelated, pre-existing, uncommitted localization pass that predates this
// entire SUSU-import session (see docs/product/susu-existing-import-*.md;
// none of tickets 9B/9D.1/9E/9F/9G touch custodian, dashboard, marketing,
// or login pages, all of which show the identical literal-string-vs-
// dictionary drift). Fixing that pre-existing, unrelated drift is out of
// this ticket's scope (identical judgment call already made and documented
// for round-lifecycle-card.test.ts in 9F). This file instead verifies only
// what 9G itself added: the circle-level imported-history banner and the
// closureBasis-aware round badges.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./active-circle-summary.tsx", import.meta.url), "utf8"),
);

test("renders the circle-level imported-history banner only when circle.originKind is IMPORTED", () => {
  assert.match(source, /circle\.originKind === "IMPORTED"/);
  assert.match(source, /copy\.importedCircleContextTitle/);
  assert.match(source, /copy\.importedCircleContextDescription/);
  assert.match(source, /circle\.historicalCompletedRoundCount/);
});

test("every getRoundStatusBadge call site passes the round's own closureBasis -- never status alone", () => {
  const calls = source.match(/getRoundStatusBadge\([^)]*\)/g) ?? [];
  assert.ok(calls.length >= 3, `expected at least 3 getRoundStatusBadge call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /closureBasis/, `expected closureBasis in call: ${call}`);
  }
});

test("imported CLOSED rounds are labeled via financial.importedHistory, never financial.closed alone", () => {
  assert.match(source, /financial\.importedHistory/);
});

test("no new mutation control was introduced by this banner (still no <button>, no <form>)", () => {
  assert.doesNotMatch(source, /<button/i);
  assert.doesNotMatch(source, /<form/i);
});
