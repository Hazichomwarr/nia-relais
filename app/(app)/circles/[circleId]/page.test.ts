import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This route renders the DRAFT draft workspace (circle terms 7I.2, member
// management 7I.3, payout ordering 7I.4, activation review 7I.5) via
// getDraftCircleForOwner + getDraftCircleActivationReview; the owner's
// active-circle summary (7I.6/7K.16) via getActiveCircleSummaryForOwner
// once ACTIVE; and (7L.3) the owner's completed-circle historical
// workspace via getCompletedCircleSummaryForOwner once COMPLETED -- fixing
// the P1 named by docs/product/susu-circle-completion-audit.md §14/§21/
// §27 (this route used to 404 for a COMPLETED circle). All data fetching
// lives in the loadWorkspaceOrSummary() helper -- JSX construction is
// never inside a try/catch (react-hooks/error-boundaries), matched here
// by asserting the try/catch block contains no JSX.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const source = stripComments(rawSource);

function extractFunctionBody(fnSource: string, name: string): string {
  const start = fnSource.indexOf(`function ${name}(`);
  const end = fnSource.indexOf("export default async function OwnerCirclePage");
  assert.ok(start >= 0, `expected to find function ${name}`);
  assert.ok(end > start, "expected OwnerCirclePage to follow the data loader in the file");
  return fnSource.slice(start, end);
}

const dataLoaderSource = extractFunctionBody(source, "loadWorkspaceOrSummary");

// The data loader nests a nested try/catch for the non-draft branch (probe
// getOwnerCirclePayouts, then branch ACTIVE/COMPLETED); isolate each region
// for targeted assertions the same way the top-level draft/active split
// already worked before this ticket.
const notDraftBranchStart = dataLoaderSource.indexOf("if (!(error instanceof DraftCircleOwnerReadNotDraftError))");
const notDraftBranch = dataLoaderSource.slice(notDraftBranchStart);
const activeSubBranch = notDraftBranch.slice(
  notDraftBranch.indexOf('payouts.circle.status === "ACTIVE"'),
  notDraftBranch.indexOf('payouts.circle.status === "COMPLETED"'),
);
const completedSubBranch = notDraftBranch.slice(
  notDraftBranch.indexOf('payouts.circle.status === "COMPLETED"'),
  notDraftBranch.indexOf("} catch (activeOrCompletedReadError)"),
);

test("data fetching happens in a dedicated helper, with ownerId flowing from the trusted authenticated user", () => {
  assert.match(source, /requireUser\(\)/);
  assert.match(source, /loadWorkspaceOrSummary\(user\.id, circleId\)/);
  assert.match(dataLoaderSource, /getDraftCircleForOwner\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(dataLoaderSource, /getDraftCircleActivationReview\(\{\s*ownerId,\s*circleId\s*\}\)/);
});

test("the draft read and the activation review are fetched in parallel", () => {
  assert.match(dataLoaderSource, /Promise\.all\(/);
});

test("no JSX is constructed inside the try/catch data-loading helper (react-hooks/error-boundaries)", () => {
  assert.match(dataLoaderSource, /try \{/);
  assert.match(dataLoaderSource, /\} catch \(error\) \{/);
  // Note: a bare `<[A-Za-z]` check would false-positive on TypeScript
  // generics like `Promise<DraftWorkspaceData ...>` -- check for actual
  // JSX return syntax and the specific tags this route renders instead.
  assert.doesNotMatch(dataLoaderSource, /return \(\s*\n/);
  for (const tag of ["<main", "<div", "<section", "<h1", "<p ", "<span"]) {
    assert.ok(!dataLoaderSource.includes(tag), `expected no JSX tag "${tag}" in the data-loading helper`);
  }
});

test("not-found and authorization failures collapse into the same generic notFound()", () => {
  assert.match(dataLoaderSource, /DraftCircleOwnerReadNotFoundError/);
  assert.match(dataLoaderSource, /DraftCircleOwnerReadAuthorizationError/);
  assert.match(dataLoaderSource, /notFound\(\)/);
});

test("a DraftCircleOwnerReadNotDraftError falls back to the ACTIVE/COMPLETED branch rather than 404ing", () => {
  assert.match(dataLoaderSource, /DraftCircleOwnerReadNotDraftError/);
});

// --- the ACTIVE/COMPLETED probe ---

test("getOwnerCirclePayouts is fetched FIRST in the not-draft branch, deciding which of the ACTIVE/COMPLETED branches to take -- not a separate, redundant probe", () => {
  assert.match(notDraftBranch, /const payouts = await getOwnerCirclePayouts\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(notDraftBranch, /payouts\.circle\.status === "ACTIVE"/);
  assert.match(notDraftBranch, /payouts\.circle\.status === "COMPLETED"/);
});

test("any status getOwnerCirclePayouts accepts but neither branch renders (e.g. ARCHIVED) falls through to notFound(), not a rendered guess", () => {
  const afterBranches = notDraftBranch.slice(notDraftBranch.lastIndexOf('return { kind: "completed"'));
  assert.match(afterBranches, /notFound\(\)/);
});

// --- ACTIVE sub-branch ---

test("the ACTIVE sub-branch fetches getActiveCircleSummaryForOwner, getOwnerCircleContributions, and getOwnerRoundLifecycle in parallel -- payouts is already fetched by the probe, never refetched", () => {
  assert.match(activeSubBranch, /getActiveCircleSummaryForOwner\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(activeSubBranch, /getOwnerCircleContributions\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(activeSubBranch, /getOwnerRoundLifecycle\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(
    activeSubBranch,
    /Promise\.all\(\[\s*getActiveCircleSummaryForOwner\([\s\S]*?getOwnerCircleContributions\([\s\S]*?getOwnerRoundLifecycle\([\s\S]*?\]\)/,
  );
  assert.doesNotMatch(activeSubBranch, /getOwnerCirclePayouts\(/);
  assert.match(activeSubBranch, /return \{ kind: "active", summary, contributions, payouts, lifecycle \}/);
});

// --- COMPLETED sub-branch ---

test("the COMPLETED sub-branch fetches getCompletedCircleSummaryForOwner and getOwnerCircleContributions in parallel -- payouts is already fetched by the probe, never refetched, and no round-lifecycle read is ever made", () => {
  assert.match(completedSubBranch, /getCompletedCircleSummaryForOwner\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(completedSubBranch, /getOwnerCircleContributions\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(
    completedSubBranch,
    /Promise\.all\(\[\s*getCompletedCircleSummaryForOwner\([\s\S]*?getOwnerCircleContributions\([\s\S]*?\]\)/,
  );
  assert.doesNotMatch(completedSubBranch, /getOwnerCirclePayouts\(/);
  assert.doesNotMatch(completedSubBranch, /getOwnerRoundLifecycle/);
  assert.doesNotMatch(completedSubBranch, /getActiveCircleSummaryForOwner/);
  assert.match(completedSubBranch, /return \{ kind: "completed", summary, contributions, payouts \}/);
});

// --- error collapsing ---

test("every ActiveCircleOwnerRead*/OwnerContributions* failure in the not-draft branch also collapses to notFound()", () => {
  assert.match(notDraftBranch, /ActiveCircleOwnerReadNotFoundError/);
  assert.match(notDraftBranch, /ActiveCircleOwnerReadAuthorizationError/);
  assert.match(notDraftBranch, /ActiveCircleOwnerReadNotActiveError/);
  assert.match(notDraftBranch, /OwnerContributionsCircleNotFoundError/);
  assert.match(notDraftBranch, /OwnerContributionsAuthorizationError/);
  assert.match(notDraftBranch, /OwnerContributionsCircleNotEligibleError/);
});

test("every OwnerPayouts* not-found/authorization/not-eligible failure also collapses to notFound() -- but NOT an integrity error", () => {
  assert.match(notDraftBranch, /OwnerPayoutsCircleNotFoundError/);
  assert.match(notDraftBranch, /OwnerPayoutsAuthorizationError/);
  assert.match(notDraftBranch, /OwnerPayoutsCircleNotEligibleError/);
  assert.doesNotMatch(notDraftBranch, /OwnerPayoutsIntegrityError/);
});

test("every OwnerRoundLifecycle* not-found/authorization/not-eligible failure also collapses to notFound() -- but NOT an integrity error", () => {
  assert.match(notDraftBranch, /OwnerRoundLifecycleCircleNotFoundError/);
  assert.match(notDraftBranch, /OwnerRoundLifecycleAuthorizationError/);
  assert.match(notDraftBranch, /OwnerRoundLifecycleCircleNotEligibleError/);
  assert.doesNotMatch(notDraftBranch, /OwnerRoundLifecycleIntegrityError/);
});

test("every CompletedCircleOwnerRead* failure also collapses to notFound() -- but NOT an unexpected error", () => {
  assert.match(notDraftBranch, /CompletedCircleOwnerReadNotFoundError/);
  assert.match(notDraftBranch, /CompletedCircleOwnerReadAuthorizationError/);
  assert.match(notDraftBranch, /CompletedCircleOwnerReadNotCompletedError/);
});

test("a genuine integrity error is deliberately left to propagate, never disguised as notFound()", () => {
  const catchBlock = notDraftBranch.slice(notDraftBranch.indexOf("catch (activeOrCompletedReadError)"));
  assert.match(catchBlock, /throw activeOrCompletedReadError;/);
});

// --- rendering ---

test("the page renders circle name, a DRAFT badge, contribution terms, the add-member form, the member list, the payout-order form, and the activation review", () => {
  assert.match(source, /circle\.name/);
  assert.match(source, />\s*DRAFT\s*</);
  assert.match(source, /<AddMemberForm circleId=\{circleId\} \/>/);
  assert.match(source, /<MemberList circleId=\{circleId\} members=\{members\} \/>/);
  assert.match(source, /<PayoutOrderForm circleId=\{circleId\} members=\{members\} \/>/);
  assert.match(source, /<ActivationReviewSection circleId=\{circleId\} review=\{review\} \/>/);
});

function extractRenderBranch(kind: "active" | "completed"): string {
  const start = source.indexOf(`data.kind === "${kind}"`);
  assert.ok(start >= 0, `expected to find data.kind === "${kind}" branch`);
  const nextBranchOrDraft = [
    source.indexOf('data.kind === "completed"', start + 1),
    source.indexOf("const { circle, members, review } = data;"),
  ].filter((index) => index > start);
  const end = Math.min(...nextBranchOrDraft);
  return source.slice(start, end);
}

test("the ACTIVE branch renders ActiveCircleSummary, RoundLifecycleCard, ContributionDesk (readOnly=false), and PayoutDesk (readOnly=false) -- no draft-only forms, no completed summary", () => {
  const activeBranch = extractRenderBranch("active");

  assert.match(activeBranch, /<ActiveCircleSummary summary=\{data\.summary\} \/>/);
  assert.match(activeBranch, /<RoundLifecycleCard circleId=\{circleId\} lifecycle=\{data\.lifecycle\} \/>/);
  assert.match(activeBranch, /<ContributionDesk circleId=\{circleId\} contributions=\{data\.contributions\} readOnly=\{false\} \/>/);
  assert.match(activeBranch, /<PayoutDesk circleId=\{circleId\} payouts=\{data\.payouts\} readOnly=\{false\} \/>/);
  assert.doesNotMatch(activeBranch, /<MemberList/);
  assert.doesNotMatch(activeBranch, /<PayoutOrderForm/);
  assert.doesNotMatch(activeBranch, /<AddMemberForm/);
  assert.doesNotMatch(activeBranch, /<ActivationReviewSection/);
  assert.doesNotMatch(activeBranch, /<CompletedCircleSummary/);
});

test("the COMPLETED branch renders CompletedCircleSummary, ContributionDesk (readOnly), and PayoutDesk (readOnly) -- no RoundLifecycleCard, no lifecycle/completion control, no draft-only forms", () => {
  const completedBranch = extractRenderBranch("completed");

  assert.match(completedBranch, /<CompletedCircleSummary summary=\{data\.summary\} \/>/);
  assert.match(completedBranch, /<ContributionDesk circleId=\{circleId\} contributions=\{data\.contributions\} readOnly \/>/);
  assert.match(completedBranch, /<PayoutDesk circleId=\{circleId\} payouts=\{data\.payouts\} readOnly \/>/);
  assert.doesNotMatch(completedBranch, /<RoundLifecycleCard/);
  assert.doesNotMatch(completedBranch, /<ActiveCircleSummary/);
  assert.doesNotMatch(completedBranch, /<MemberList/);
  assert.doesNotMatch(completedBranch, /<PayoutOrderForm/);
  assert.doesNotMatch(completedBranch, /<AddMemberForm/);
  assert.doesNotMatch(completedBranch, /<ActivationReviewSection/);
  assert.doesNotMatch(completedBranch, /CompleteCircleForm/);
  assert.doesNotMatch(completedBranch, /StartFirstRoundForm/);
  assert.doesNotMatch(completedBranch, /AdvanceRoundForm/);
});

test("placement: RoundLifecycleCard renders between ActiveCircleSummary and ContributionDesk (7K.16 section 5)", () => {
  const activeBranch = extractRenderBranch("active");

  const summaryIndex = activeBranch.indexOf("<ActiveCircleSummary");
  const lifecycleIndex = activeBranch.indexOf("<RoundLifecycleCard");
  const contributionIndex = activeBranch.indexOf("<ContributionDesk");
  assert.ok(summaryIndex >= 0 && lifecycleIndex > summaryIndex && contributionIndex > lifecycleIndex);
});

test("the DRAFT branch never renders PayoutDesk, the round-lifecycle card, or the completed summary", () => {
  const draftBranch = source.slice(source.indexOf("const { circle, members, review } = data;"));
  assert.doesNotMatch(draftBranch, /<PayoutDesk/);
  assert.doesNotMatch(draftBranch, /<RoundLifecycleCard/);
  assert.doesNotMatch(draftBranch, /<CompletedCircleSummary/);
  assert.doesNotMatch(draftBranch, /getOwnerRoundLifecycle/);
});

test("no completion mutation control (CompleteCircleForm) is ever rendered directly on this page -- it lives only inside RoundLifecycleCard's own ALL_ROUNDS_CLOSED branch", () => {
  assert.doesNotMatch(source, /CompleteCircleForm/);
  assert.doesNotMatch(source, /complete-circle-controls/);
});

test("no archive branch, control, or copy exists anywhere on this page (7L §16/7L.3 section 25, deferred)", () => {
  assert.doesNotMatch(source, /ARCHIVED/);
  assert.doesNotMatch(source, /archiveCircle/i);
  assert.doesNotMatch(rawSource, /Archive circle/i);
});

test("the destination page is a server component with no client-side auth of its own and no member-session identity", () => {
  assert.doesNotMatch(rawSource, /^"use client";?/m);
  assert.doesNotMatch(source, /requireCircleMember/);
  assert.doesNotMatch(source, /validateCircleMemberSession/);
  assert.doesNotMatch(source, /next-auth/);
  assert.doesNotMatch(source, /nia_member_session/);
});

test("no financial mutation call exists on this page", () => {
  assert.doesNotMatch(source, /\.create\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /prisma\./);
});

test("the shared (app) layout this page relies on for authentication still calls requireUser()", () => {
  const layoutSource = readFileSync(new URL("../../layout.tsx", import.meta.url), "utf8");
  assert.match(layoutSource, /requireUser\(\)/);
});
