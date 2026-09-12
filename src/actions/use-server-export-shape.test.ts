import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Structural regression guard (hotfix, P1) for the actual discovered
// failure mode, NOT a stand-in for the real fix verification (that
// evidence is the authenticated dev-server reproduction recorded in the
// hotfix report, not this test).
//
// Root cause, confirmed against the real compiled Turbopack output
// (`.next/dev/server/chunks/ssr/*.js`), not assumed: a "use server" file
// whose export list contains a bare TYPE re-export specifier list --
// `export type { A, B, C };` (optionally `from "..."`) -- gets its named
// specifiers swept into Next.js/Turbopack's "use server" action-reference
// collector exactly like a real value export would be. The collector
// emits `registerServerReference(A, "<hash>", null)` for each one
// regardless of the `type` keyword, and since `export type {...}` is
// fully erased by the TypeScript/SWC compiler (no runtime binding for A
// ever exists in that scope), the emitted reference throws
// `ReferenceError: A is not defined` the moment the module evaluates.
//
// Verified NOT to reproduce for the other, syntactically different form,
// `export type Foo = { ... };` (a direct type-ALIAS declaration, not a
// specifier-list re-export) -- grepping the same real compiled output for
// every such type name already used elsewhere in this codebase
// (auth.actions.ts's LoginActionState, deposit.actions.ts's
// CreateDepositActionState, custodian.actions.ts's
// CreateCustodianAssignmentActionState, goal.actions.ts's
// CreatePersonalGoalActionState) found zero occurrences as a runtime
// reference -- that form is cleanly erased. This guard therefore
// forbids only the specifier-list re-export form inside any "use server"
// file, not `export type` in general -- over-constraining to ban every
// `export type` would incorrectly flag those already-safe, pre-existing
// files.
//
// This is a necessary-condition source guard, not a substitute for a
// real build/runtime check: it cannot itself prove the Turbopack
// transform's behavior (that requires an actual compile), but it does
// prevent the exact source pattern that produced this failure from ever
// being reintroduced into any "use server" file in this codebase, in any
// future ticket.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const ACTIONS_DIR = new URL("./", import.meta.url);
const actionFiles = readdirSync(ACTIONS_DIR)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

const useServerFiles = actionFiles.filter((name) => {
  const raw = readFileSync(new URL(name, ACTIONS_DIR), "utf8");
  return /^"use server";/.test(raw);
});

test("at least one 'use server' file exists in src/actions/ -- this guard is not accidentally scanning zero files", () => {
  assert.ok(useServerFiles.length > 0);
});

for (const name of useServerFiles) {
  test(`${name}: no bare type re-export specifier list ("export type { ... }") -- the exact construct that produced the ReferenceError`, () => {
    const source = stripComments(readFileSync(new URL(name, ACTIONS_DIR), "utf8"));
    // Matches `export type {` (a specifier-list re-export) but NOT
    // `export type Foo = {` (a direct type-alias declaration, confirmed
    // safe -- see module comment) -- the identifier+`=` between `type`
    // and `{` in the alias form means only the specifier-list form can
    // ever match `type` immediately followed by `{`.
    assert.doesNotMatch(
      source,
      /export\s+type\s*\{/,
      `${name} contains a type re-export specifier list, which triggers the Turbopack "use server" ReferenceError`,
    );
  });
}

// Positive check for the four files this hotfix actually touched: each
// now imports its action-state type(s) directly from the owning
// testable-core module, not from the "use server" wrapper that used to
// re-export them. Scoped to exactly these four -- NOT a blanket "a
// .state.ts file may never import from a 'use server' file" rule, which
// would be wrong: auth.state.ts/deposit.state.ts/goal.state.ts already
// safely import a type from their own sibling "use server" file today,
// because that type is a direct `export type Foo = { ... }` alias
// declaration there (confirmed safe by the module comment above), never
// a specifier-list re-export -- test 1 above already guarantees no
// wrapper file can regress into the unsafe form.
const FIXED_STATE_MODULE_ORIGINS: Record<string, string[]> = {
  "circle.state.ts": [
    "@/src/actions/activate-circle",
    "@/src/actions/add-draft-circle-member",
    "@/src/actions/confirm-contribution",
    "@/src/actions/create-draft-circle",
    "@/src/actions/record-contribution",
    "@/src/actions/reject-contribution",
    "@/src/actions/set-draft-circle-payout-order",
  ],
  "payout.state.ts": [
    "@/src/actions/confirm-payout",
    "@/src/actions/dispute-payout",
    "@/src/actions/record-payout",
  ],
  "round-lifecycle.state.ts": [
    "@/src/actions/activate-first-round",
    "@/src/actions/advance-round",
  ],
  "circle-completion.state.ts": ["@/src/actions/complete-circle"],
};

for (const [stateFile, originModules] of Object.entries(FIXED_STATE_MODULE_ORIGINS)) {
  test(`${stateFile}: imports its action-state type(s) from the owning core module(s), not the "use server" wrapper`, () => {
    const source = stripComments(readFileSync(new URL(stateFile, ACTIONS_DIR), "utf8"));
    const wrapperName = stateFile.replace(".state.ts", ".actions");
    assert.ok(
      !source.includes(`@/src/actions/${wrapperName}"`),
      `${stateFile} still imports from @/src/actions/${wrapperName} (the "use server" wrapper) instead of the owning core module(s)`,
    );
    for (const originModule of originModules) {
      assert.ok(source.includes(originModule), `expected ${stateFile} to import from ${originModule}`);
    }
  });
}
