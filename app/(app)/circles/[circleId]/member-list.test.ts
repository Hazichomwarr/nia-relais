import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./member-list.tsx", import.meta.url), "utf8"),
);

// active and removed member rendering
test("renders both an active-members group and a removed (history) group, filtered by status", () => {
  assert.match(source, /member\.status === "ACTIVE"/);
  assert.match(source, /member\.status === "REMOVED"/);
});

// removed history preserved / no reactivation control
test("removed members render with no reactivation control -- only active members get a RemoveMemberButton", () => {
  const removedHeadingIndex = source.indexOf("Removed (history)");
  const removeButtonIndex = source.indexOf("RemoveMemberButton");
  assert.ok(removedHeadingIndex >= 0, "expected to find the removed-members section heading");
  assert.ok(removeButtonIndex >= 0, "expected to find RemoveMemberButton somewhere in the active section");
  assert.ok(removeButtonIndex < removedHeadingIndex, "RemoveMemberButton must appear only in the active section, before the removed section");

  const removedSection = source.slice(removedHeadingIndex);
  assert.doesNotMatch(removedSection, /RemoveMemberButton/);
  assert.doesNotMatch(removedSection, /[Rr]eactivat/);
});

test("only active members are offered a RemoveMemberButton", () => {
  const activeSectionMatch = source.match(/activeMembers\.map[\s\S]*?RemoveMemberButton/);
  assert.ok(activeSectionMatch, "expected RemoveMemberButton to appear within the active-members map");
});

test("no pinHash, credentialVersion, lockout, session, or internal actor id fields are rendered", () => {
  for (const forbidden of ["pinHash", "credentialVersion", "failedPinAttempts", "lockedUntil", "addedById", "removedById", "CircleMemberSession"]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
});
