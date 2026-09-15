import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("the owner route derives its scope from requireUser and forwards the trusted user id to existing owner reads", () => {
  assert.match(source, /requireUser\(\)/);
  assert.match(source, /loadWorkspaceOrSummary\(user\.id, circleId\)/);
  assert.match(source, /getActiveCircleSummaryForOwner\(\{ ownerId, circleId \}\)/);
  assert.match(source, /getOwnerCircleContributions\(\{ ownerId, circleId \}\)/);
  assert.match(source, /getOwnerCirclePayouts\(\{ ownerId, circleId \}\)/);
});

test("workspace navigation accepts only known sections and defaults to Overview", () => {
  assert.match(source, /getCircleWorkspaceSection\(requestedSection\)/);
  assert.match(source, /section === "overview"/);
  assert.match(source, /CircleWorkspaceNavigation/);
});

test("the ACTIVE overview uses existing authoritative read models and detailed operations only render in their own section", () => {
  assert.match(source, /ActiveCircleWorkspaceOverview[\s\S]*summary=\{data\.summary\}[\s\S]*contributions=\{data\.contributions\}[\s\S]*payouts=\{data\.payouts\}[\s\S]*lifecycle=\{data\.lifecycle\}/);
  assert.match(source, /section === "contributions" \? <ContributionDesk/);
  assert.match(source, /section === "payouts" \? <PayoutDesk/);
  assert.match(source, /section === "schedule" \? <div[\s\S]*<RoundLifecycleCard/);
});

test("completed circles retain navigation but contribution and payout views are explicitly read-only", () => {
  // Both call sites gained dictionary/locale props from an unrelated,
  // pre-existing localization pass (predating 9B-9H's own import work,
  // determined via 9H §25's own pre-existing-drift review) -- readOnly is
  // still passed as a bare boolean prop (shorthand for readOnly={true}),
  // which is the actual behavioral fact this test protects.
  assert.match(source, /CompletedCircleWorkspaceOverview/);
  assert.match(source, /<ContributionDesk circleId=\{circleId\} contributions=\{data\.contributions\} readOnly dictionary=\{dictionary\} locale=\{locale\} \/>/);
  assert.match(source, /<PayoutDesk circleId=\{circleId\} payouts=\{data\.payouts\} readOnly dictionary=\{dictionary\} locale=\{locale\} \/>/);
  assert.doesNotMatch(source, /completedSections[\s\S]*RoundLifecycleCard/);
});

test("draft workspace preserves the sequential setup flow and private member handling components", () => {
  assert.match(source, /draftSections[\s\S]*"members"[\s\S]*"schedule"/);
  assert.match(source, /<AddMemberForm circleId=\{circleId\} dictionary=\{dictionary\}/);
  assert.match(source, /<MemberList circleId=\{circleId\} members=\{members\} dictionary=\{dictionary\} locale=\{locale\}/);
  assert.match(source, /<PayoutOrderForm circleId=\{circleId\} members=\{members\} dictionary=\{dictionary\}/);
  assert.match(source, /<ActivationReviewSection circleId=\{circleId\} review=\{review\} dictionary=\{dictionary\} locale=\{locale\}/);
});

test("the page adds no Prisma writes, member-session identity, or archive controls", () => {
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /archiveCircle/i);
});
