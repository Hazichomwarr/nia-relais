import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./remove-member-button.tsx", import.meta.url), "utf8"),
);

test("removal requires an explicit confirmation before the form actually submits", () => {
  assert.match(source, /window\.confirm\(/);
  assert.match(source, /if \(!confirmed\) event\.preventDefault\(\);/);
});

test("binds directly to removeDraftCircleMemberAction, a plain single-argument action, not useActionState", () => {
  assert.match(source, /action=\{removeDraftCircleMemberAction\}/);
  assert.doesNotMatch(source, /useActionState/);
});

test("submits only circleId and memberId -- no ownerId, status, or provenance", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["circleId", "memberId"]);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
});
