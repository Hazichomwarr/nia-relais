import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This route renders the DRAFT draft workspace (circle terms 7I.2, member
// management 7I.3, payout ordering 7I.4, activation review 7I.5) via
// getDraftCircleForOwner + getDraftCircleActivationReview, and the owner's
// active-circle summary (7I.6) via getActiveCircleSummaryForOwner when the
// circle is no longer a draft. All data fetching lives in the
// loadWorkspaceOrSummary() helper -- JSX construction is never inside a
// try/catch (react-hooks/error-boundaries), matched here by asserting the
// try/catch block contains no JSX.

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

test("a DraftCircleOwnerReadNotDraftError falls back to a minimal, owner-scoped ACTIVE read rather than 404ing", () => {
  assert.match(dataLoaderSource, /DraftCircleOwnerReadNotDraftError/);
  assert.match(dataLoaderSource, /getActiveCircleSummaryForOwner\(\{\s*ownerId,\s*circleId\s*\}\)/);
});

test("the ACTIVE fallback also fetches getOwnerCircleContributions, in parallel with the summary, not via a duplicate read model", () => {
  assert.match(dataLoaderSource, /getOwnerCircleContributions\(\{\s*ownerId,\s*circleId\s*\}\)/);
  assert.match(
    dataLoaderSource,
    /Promise\.all\(\[\s*getActiveCircleSummaryForOwner\([\s\S]*?getOwnerCircleContributions\([\s\S]*?\]\)/,
  );
});

test("every ActiveCircleOwnerRead* and OwnerContributions* failure in the fallback also collapses to notFound()", () => {
  assert.match(dataLoaderSource, /ActiveCircleOwnerReadNotFoundError/);
  assert.match(dataLoaderSource, /ActiveCircleOwnerReadAuthorizationError/);
  assert.match(dataLoaderSource, /ActiveCircleOwnerReadNotActiveError/);
  assert.match(dataLoaderSource, /OwnerContributionsCircleNotFoundError/);
  assert.match(dataLoaderSource, /OwnerContributionsAuthorizationError/);
  assert.match(dataLoaderSource, /OwnerContributionsCircleNotActiveError/);
});

test("the page renders circle name, a DRAFT badge, contribution terms, the add-member form, the member list, the payout-order form, and the activation review", () => {
  assert.match(source, /circle\.name/);
  assert.match(source, />\s*DRAFT\s*</);
  assert.match(source, /<AddMemberForm circleId=\{circleId\} \/>/);
  assert.match(source, /<MemberList circleId=\{circleId\} members=\{members\} \/>/);
  assert.match(source, /<PayoutOrderForm circleId=\{circleId\} members=\{members\} \/>/);
  assert.match(source, /<ActivationReviewSection circleId=\{circleId\} review=\{review\} \/>/);
});

test("the ACTIVE branch renders ActiveCircleSummary and ContributionDesk -- no draft-only forms or controls", () => {
  const activeBranchIndex = source.indexOf('data.kind === "active"');
  const draftDestructureIndex = source.indexOf("const { circle, members, review } = data;");
  assert.ok(activeBranchIndex >= 0 && draftDestructureIndex > activeBranchIndex);
  const activeBranch = source.slice(activeBranchIndex, draftDestructureIndex);

  assert.match(activeBranch, /<ActiveCircleSummary summary=\{data\.summary\} \/>/);
  assert.match(activeBranch, /<ContributionDesk circleId=\{circleId\} contributions=\{data\.contributions\} \/>/);
  assert.doesNotMatch(activeBranch, /<MemberList/);
  assert.doesNotMatch(activeBranch, /<PayoutOrderForm/);
  assert.doesNotMatch(activeBranch, /<AddMemberForm/);
  assert.doesNotMatch(activeBranch, /<ActivationReviewSection/);
});

test("COMPLETED/ARCHIVED handling is documented in the file itself as a future lifecycle dependency, not silently misrepresented", () => {
  // Checked against the RAW (comment-including) source -- this is
  // documentary, living only in a comment, which `source` above has
  // already stripped for the code-shape assertions elsewhere in this file.
  assert.match(rawSource, /Future lifecycle dependency/);
  assert.match(rawSource, /COMPLETED\/ARCHIVED/);
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
