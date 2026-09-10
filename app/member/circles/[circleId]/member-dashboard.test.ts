import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual page and component source, mirroring the
// pattern used for the member login screen (member-login-form.test.ts):
// no DOM/React render is exercised (no new testing-library/jsdom dependency
// is added for this ticket), so these assertions read the real source text
// for the properties that matter most -- authorization wiring, privacy,
// and the absence of any write/mutation path. Wording and state-selection
// logic are covered behaviorally in member-dashboard-display.test.ts.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readHere(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const pageSource = stripComments(readHere("./page.tsx"));
const componentSource = stripComments(readHere("./member-dashboard.tsx"));
const displaySource = stripComments(readHere("./member-dashboard-display.ts"));

// --- authorized read-model integration ---

test("the page authorizes via requireCircleMember before fetching the read model", () => {
  const authorizeIndex = pageSource.indexOf("requireCircleMember(circleId)");
  const fetchIndex = pageSource.indexOf("getCircleMemberDashboard(identity)");
  assert.ok(authorizeIndex >= 0, "expected requireCircleMember(circleId) to be called");
  assert.ok(fetchIndex >= 0, "expected getCircleMemberDashboard(identity) to be called");
  assert.ok(authorizeIndex < fetchIndex, "authorization must happen before the read model is fetched");
});

// --- no client-supplied memberId ---

test("the page never derives memberId from params, searchParams, or any client-suppliable value", () => {
  assert.doesNotMatch(pageSource, /searchParams/);
  assert.doesNotMatch(pageSource, /memberId\s*[:=]\s*circleId/);
  assert.doesNotMatch(pageSource, /\.get\(\s*["']memberId["']\s*\)/);
  // getCircleMemberDashboard is called with the identity object returned by
  // requireCircleMember, not with any hand-built object.
  assert.match(pageSource, /getCircleMemberDashboard\(identity\)/);
});

// --- confirmed-only contribution labels ---

test("the contributions section only renders the service's own confirmed/expected/outstanding fields", () => {
  assert.match(componentSource, /obligation\.confirmedAmount/);
  assert.match(componentSource, /obligation\.expectedAmount/);
  assert.match(componentSource, /obligation\.outstandingAmount/);
  // Never a separate "recorded" contribution figure -- the service already
  // excludes RECORDED/REJECTED payments from confirmedAmount, and nothing
  // here reintroduces them.
  assert.doesNotMatch(componentSource, /obligation\.status/);
});

// --- payout: no confirmation button yet, and receipt is never inferred from round status ---

test("the payout card renders no confirmation action (no <button>, no form) and never branches on round status", () => {
  assert.doesNotMatch(componentSource, /<button/i);
  assert.doesNotMatch(componentSource, /<form/i);
  // Payout presentation is driven only by getPayoutPresentation(payout) --
  // never by comparing against a round's own status field.
  assert.doesNotMatch(componentSource, /getPayoutPresentation\([^)]*round/i);
});

// --- no other-member financial details ---

test("the rotation schedule never renders any per-member financial figure, only round-level fields", () => {
  const scheduleSectionMatch = componentSource.match(/function RotationScheduleCard[\s\S]*?\n}\n/);
  assert.ok(scheduleSectionMatch, "expected to find RotationScheduleCard's body");
  const scheduleSection = scheduleSectionMatch![0];

  for (const forbidden of ["confirmedAmount", "expectedAmount", "outstandingAmount", "memberCode", "email", "pinHash"]) {
    assert.doesNotMatch(scheduleSection, new RegExp(forbidden));
  }
  // recipientDisplayName is the one intentionally shared, circle-wide field.
  assert.match(scheduleSection, /recipientDisplayName/);
});

// --- no credential/session leakage ---

test("no source file in this route references pinHash, memberCode, email, credentialVersion, or session/token fields", () => {
  for (const source of [pageSource, componentSource, displaySource]) {
    for (const forbidden of ["pinHash", "memberCode", "email", "credentialVersion", "tokenHash", "failedPinAttempts", "lockedUntil"]) {
      assert.doesNotMatch(source, new RegExp(forbidden));
    }
  }
});

test("no source file in this route imports platform Auth.js", () => {
  for (const source of [pageSource, componentSource, displaySource]) {
    assert.doesNotMatch(source, /next-auth/);
    assert.doesNotMatch(source, /["']@\/auth["']/);
  }
});

// --- no financial mutations ---

test("no source file in this route references Prisma writes or any writer service", () => {
  for (const source of [pageSource, componentSource, displaySource]) {
    assert.doesNotMatch(source, /prisma\./);
    assert.doesNotMatch(source, /\.create\(/);
    assert.doesNotMatch(source, /\.update\(/);
    assert.doesNotMatch(source, /\.delete\(/);
  }
});

// --- responsive rendering / no chart or animation libraries ---

test("the dashboard uses mobile-first responsive classes and avoids chart/animation libraries", () => {
  assert.match(componentSource, /sm:/, "expected at least one sm: responsive utility class");
  assert.match(componentSource, /max-w-2xl/);
  for (const forbidden of ["recharts", "chart.js", "d3", "framer-motion"]) {
    assert.doesNotMatch(componentSource, new RegExp(forbidden, "i"));
  }
});

// --- errors are handled without leaking database/circle-existence details ---

test("internal read-model integrity errors redirect to /member/login rather than propagate a raw error", () => {
  assert.match(pageSource, /CircleMemberDashboardCircleNotFoundError/);
  assert.match(pageSource, /CircleMemberDashboardCircleNotEligibleError/);
  assert.match(pageSource, /CircleMemberDashboardMemberNotFoundError/);
  assert.match(pageSource, /CircleMemberDashboardMemberNotActiveError/);
  assert.match(pageSource, /redirect\(\s*["']\/member\/login["']\s*\)/);
});

// --- 7K.10: MemberDashboard gained an additive children slot only ---

test("MemberDashboard accepts an optional children slot, rendered after every existing card -- getCircleMemberDashboard itself is not touched", () => {
  assert.match(componentSource, /children\?: React\.ReactNode/);
  // {children} must appear strictly after the last existing card
  // (RotationScheduleCard) so the new payout card (7K.10) is additive,
  // never inserted between or in place of an existing one.
  const rotationIndex = componentSource.indexOf("<RotationScheduleCard");
  const childrenIndex = componentSource.indexOf("{children}");
  assert.ok(rotationIndex >= 0 && childrenIndex > rotationIndex);
  assert.doesNotMatch(componentSource, /getCircleMemberPayouts/, "the dashboard component itself must not fetch the 7K.8 read model");
});
