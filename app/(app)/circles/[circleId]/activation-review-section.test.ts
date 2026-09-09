import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = stripComments(
  readFileSync(new URL("./activation-review-section.tsx", import.meta.url), "utf8"),
);

test("uses the existing action and its initial state, not a new action framework", () => {
  assert.match(source, /useActionState\(activateCircleAction, initialActivateCircleState\)/);
});

test("submits circleId, an explicit confirmation, and the review fingerprint -- nothing else", () => {
  const nameAttributes = [...source.matchAll(/name="([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nameAttributes.sort(), ["circleId", "confirmed", "reviewFingerprint"]);
});

test("no ownerId, member ids, payout order values, totals, rounds, or obligations are ever submitted", () => {
  for (const forbidden of ["ownerId", "orderedMemberIds", "payoutOrder=", "expectedTotalAcrossRotation=", "name=\"status\""]) {
    assert.ok(!source.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
});

test("the review fingerprint submitted is computed via the shared, pure fingerprint function", () => {
  assert.match(source, /computeActivationReviewFingerprint\(review\)/);
  assert.match(source, /from ["']@\/src\/domain\/circle-activation-review["']/);
});

// The activation button must be unavailable while eligibility blockers
// exist, confirmation is unchecked, or submission is pending.
test("the activate button is disabled unless eligible AND confirmed AND not pending, all three", () => {
  assert.match(source, /const canActivate = review\.eligible && confirmed && !pending;/);
  assert.match(source, /type="submit"[\s\S]*?disabled=\{!canActivate\}/);
});

test("the confirmation checkbox itself is disabled when the review is not eligible", () => {
  assert.match(source, /type="checkbox"[\s\S]*?disabled=\{!review\.eligible\}/);
});

test("plainly states that members, terms, and payout order are locked after activation, and that NIA does not hold or transfer money", () => {
  assert.match(source, /can no longer be changed/);
  assert.match(source, /does not hold or transfer money/);
});

test("never implies money has already been collected or paid -- amounts are framed as expected, not collected", () => {
  assert.match(source, /Expected/);
  // The one legitimate use of "already" is the disclaimer explicitly
  // denying collection ("not ... already collected or paid out") -- an
  // affirmative claim would read "has been"/"was" collected/paid instead.
  assert.doesNotMatch(source, /has been (collected|paid)/i);
  assert.doesNotMatch(source, /\bwas (collected|paid)/i);
  assert.match(source, /not.*already (collected|paid)/i);
});

test("no PIN, pinHash, or session field is ever rendered", () => {
  assert.doesNotMatch(source, /\bpin\b/i);
  assert.doesNotMatch(source, /pinHash/);
  assert.doesNotMatch(source, /nia_member_session/);
});

test("no direct Prisma reference or member-session identity import", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
});
