import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

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

test("uses localized activation lock and money-disclaimer copy", () => {
  assert.match(source, /copy\.activationFrozenNotice/);
  assert.match(source, /copy\.expectedDisclaimer/);
  assert.match(en.susu.activationFrozenNotice, /can no longer be changed/);
  assert.match(fr.susu.activationFrozenNotice, /ne pourront plus être modifiés/);
  assert.match(en.susu.expectedDisclaimer, /does not hold or transfer money/);
  assert.match(fr.susu.expectedDisclaimer, /ne détient ni ne transfère d’argent/);
});

test("uses localized expected-amount framing without implying collection", () => {
  assert.match(source, /copy\.expectedContribution/);
  assert.match(source, /copy\.expectedCollection/);
  assert.match(en.susu.expectedDisclaimer, /not money already collected or paid out/);
  assert.match(fr.susu.expectedDisclaimer, /n’ont pas encore été collectés ni versés/);
  assert.doesNotMatch(en.susu.expectedDisclaimer, /has been (collected|paid)/i);
  assert.doesNotMatch(fr.susu.expectedDisclaimer, /\ba été (collecté|versé)/i);
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
