import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- circle.state.ts's own imports are not safe
// to execute directly under the plain Node test harness (circle.actions.ts,
// which this file used to import from, statically imports
// next/navigation's redirect()).
//
// SUPERSEDED (hotfix): this file previously imported every *ActionState
// type from circle.actions.ts (a "use server" module) via a single
// `import type { ... } from "@/src/actions/circle.actions";` block, and
// this test file asserted that whole-block-is-type-only shape as
// correct. It was syntactically correct and tsc-clean, but wrong at the
// bundler level: circle.actions.ts was re-exporting those same types via
// a barrel `export type { ... };`, which Next.js/Turbopack's "use server"
// transform does not treat as type-only -- it swept them into the
// action-reference manifest and crashed with
// "ReferenceError: <Name> is not defined" on the real compiled dev
// bundle (confirmed, reproduced on POST /circles/new). Whether THIS
// file's own import carried the `type` keyword was never actually the
// deciding factor -- the defect lived entirely in circle.actions.ts's
// own re-export shape, which is why this test alone (however correct its
// own assertions were) could not have caught the real failure.
//
// The actual fix: each type is now imported directly from its own owning
// core module (activate-circle.ts, add-draft-circle-member.ts, ...),
// never from circle.actions.ts at all -- see circle.actions.ts's own
// comment, and use-server-export-shape.test.ts for the systemic,
// codebase-wide version of this guard.

const source = readFileSync(new URL("./circle.state.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

const ORIGIN_MODULES = [
  "@/src/actions/activate-circle",
  "@/src/actions/add-draft-circle-member",
  "@/src/actions/confirm-contribution",
  "@/src/actions/create-draft-circle",
  "@/src/actions/record-contribution",
  "@/src/actions/reject-contribution",
  "@/src/actions/set-draft-circle-payout-order",
];

test("no import of any kind exists from circle.actions.ts (a \"use server\" file) -- every type comes from its own owning core module instead", () => {
  assert.doesNotMatch(source, /from "@\/src\/actions\/circle\.actions"/);
});

test("each *ActionState type is imported as `import type` directly from its own owning core module", () => {
  for (const originModule of ORIGIN_MODULES) {
    const typedImport = new RegExp(`^import type \\{[\\s\\S]*?\\} from "${originModule.replace(/\//g, "\\/")}";`, "m");
    assert.match(source, typedImport, `expected a type-only import from ${originModule}`);
  }
});

test("every initial*State constant is a plain empty object, never a call into the action module", () => {
  const constants = [...source.matchAll(/export const (\w+): (\w+) = (\{\});/g)];
  assert.equal(constants.length, 7, "expected exactly 7 initial-state constants");
  for (const [, name] of constants) {
    assert.match(name, /^initial[A-Z]/);
  }
});
