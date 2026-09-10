import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- circle.state.ts imports its *ActionState
// types from circle.actions.ts (a real "use server" module that
// statically imports next/navigation's redirect()), so it is not safe to
// import/execute directly under the plain Node test harness.
//
// Type-vs-runtime export regression guard (hotfix): this file's entire
// purpose is to hold `initial*State = {}` constants typed by symbols
// declared elsewhere -- every import here must be `import type`, never a
// runtime import. If it were ever a runtime import, Next's Server Actions
// module loader would try to resolve an erased symbol (ActivateCircleActionState,
// et al. are `export type` in circle.actions.ts) at module-evaluation
// time and crash with "ReferenceError: <Name> is not defined" the instant
// any page importing this file (e.g. /circles/new's new-circle-form.tsx)
// loads -- a failure tsc alone does not catch, since `import type` and a
// plain `import` are both syntactically valid to it.

const source = readFileSync(new URL("./circle.state.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

test("the entire import from circle.actions.ts is type-only", () => {
  assert.match(source, /^import type \{[\s\S]*?\} from "@\/src\/actions\/circle\.actions";/m);
});

test("no plain (non-type) import from circle.actions.ts exists anywhere in this file", () => {
  const nonTypeImport = /import \{[^}]*\} from "@\/src\/actions\/circle\.actions"/;
  assert.doesNotMatch(source, nonTypeImport);
});

test("every initial*State constant is a plain empty object, never a call into the action module", () => {
  const constants = [...source.matchAll(/export const (\w+): (\w+) = (\{\});/g)];
  assert.equal(constants.length, 7, "expected exactly 7 initial-state constants");
  for (const [, name] of constants) {
    assert.match(name, /^initial[A-Z]/);
  }
});
