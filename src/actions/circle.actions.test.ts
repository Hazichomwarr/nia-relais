import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks only -- circle.actions.ts statically imports
// next/navigation's redirect() and is therefore not safe to import/execute
// directly under the plain Node test harness (see create-draft-circle.ts's
// own comment on why that import is deferred there). All of its real
// behavior is delegated to runCreateDraftCircleAction, which IS fully
// behaviorally tested in create-draft-circle.test.ts. This mirrors the
// route.ts/page.tsx structural-test pattern used throughout this ticket
// sequence (e.g. app/api/member/auth/login/route.ts,
// app/member/circles/[circleId]/page.tsx).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./circle.actions.ts", import.meta.url), "utf8"),
);

test("the file is a real Server Action module", () => {
  assert.match(source, /^"use server";/);
});

test("createDraftCircleAction delegates to runCreateDraftCircleAction rather than reimplementing validation/service logic", () => {
  assert.match(source, /runCreateDraftCircleAction\(formData\)/);
  // No inline Zod parsing or direct createDraftCircle service call here --
  // that would duplicate domain validation the core module already owns.
  assert.doesNotMatch(source, /createDraftCircleSchema/);
  assert.doesNotMatch(source, /from ["']@\/src\/services\/circle\.service["']/);
});

// H. successful redirect uses returned circleId
test("on success, the action redirects to /circles/<the outcome's own circleId>, not a hardcoded or different field", () => {
  assert.match(source, /redirect\(\s*`\/circles\/\$\{encodeURIComponent\(outcome\.circleId\)\}`\s*\)/);
});

test("a failed outcome returns its own state instead of redirecting", () => {
  assert.match(source, /if \(!outcome\.ok\) return outcome\.state;/);
});

// no member/session identity dependency
test("no reference to the member-session identity system or platform Auth.js internals beyond next/navigation", () => {
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session", "next-auth"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

// no domain/schema mutation outside existing createDraftCircle
test("no direct Prisma reference or other circle-mutating service import", () => {
  assert.doesNotMatch(source, /prisma\./);
  for (const forbidden of ["addDraftCircleMember", "removeDraftCircleMember", "setDraftCirclePayoutOrder", "activateCircle"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});
