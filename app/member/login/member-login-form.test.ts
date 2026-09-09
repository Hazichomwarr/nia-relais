import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural checks on the actual client component source. A real DOM/React
// render isn't exercised here (no new testing-library/jsdom dependency is
// added to the project for this ticket) -- these assertions instead read
// the component's own source text for the properties that matter most from
// a security and correctness standpoint: what it sends, what it stores,
// and what it imports. Pure logic (validation, payload shape, navigation
// target) is covered behaviorally in member-login-form.logic.test.ts.

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readHere(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const formSource = stripComments(readHere("./member-login-form.tsx"));
const pageSource = stripComments(readHere("./page.tsx"));
const circlePageSource = stripComments(readHere("../circles/[circleId]/page.tsx"));

test("the form submits to the exact member login API route", () => {
  assert.match(formSource, /fetch\(\s*["']\/api\/member\/auth\/login["']/);
});

test("the form sends exactly the built payload, not the raw circleId/memberCode/pin state directly", () => {
  assert.match(formSource, /body:\s*JSON\.stringify\(payload\)/);
  assert.match(formSource, /buildMemberLoginRequestPayload\(values\)/);
});

// --- loading / duplicate-submit behavior ---

test("submission is guarded by a synchronous ref check before any fetch call", () => {
  const guardIndex = formSource.search(/isSubmittingRef\.current\)\s*return/);
  const fetchIndex = formSource.indexOf("fetch(");
  assert.ok(guardIndex >= 0, "expected an early-return guard on isSubmittingRef.current");
  assert.ok(fetchIndex > guardIndex, "expected the guard to appear before the fetch call");
});

test("the submit button is disabled while submitting", () => {
  assert.match(formSource, /type="submit"[\s\S]*?disabled=\{isSubmitting\}/);
});

// --- generic error handling ---

test("an unsuccessful login response produces the single generic auth error, not a detailed one", () => {
  assert.match(formSource, /setFormError\(GENERIC_MEMBER_AUTH_ERROR\)/);
});

test("a network/fetch failure produces a distinct, still-generic network error", () => {
  assert.match(formSource, /setFormError\(MEMBER_AUTH_NETWORK_ERROR\)/);
});

test("only one generic auth error message constant exists and it names no credential specifically", () => {
  const logicSource = readHere("./member-login-form.logic.ts");
  const match = logicSource.match(/GENERIC_MEMBER_AUTH_ERROR\s*=\s*\n?\s*"([^"]+)"/);
  assert.ok(match, "expected to find GENERIC_MEMBER_AUTH_ERROR's literal text");
  const message = match![1].toLowerCase();
  for (const forbidden of ["pin is wrong", "pin was wrong", "member code does not exist", "circle does not exist", "locked", "removed", "draft"]) {
    assert.ok(!message.includes(forbidden), `error message must not reveal "${forbidden}"`);
  }
});

// --- successful navigation ---

test("a successful login navigates via router.push to the circle href built from circleId alone", () => {
  assert.match(formSource, /router\.push\(buildMemberCircleHref\(payload\.circleId\)\)/);
});

// --- no credentials in URLs/storage ---

test("the form never touches localStorage, sessionStorage, or document.cookie", () => {
  for (const source of [formSource, pageSource]) {
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /sessionStorage/);
    assert.doesNotMatch(source, /document\.cookie/);
  }
});

test("no navigation or fetch target in the form ever embeds memberCode or pin in a URL", () => {
  const urlLikeLines = formSource
    .split("\n")
    .filter((line) => /router\.push|fetch\(/.test(line));
  for (const line of urlLikeLines) {
    assert.doesNotMatch(line, /memberCode/);
    assert.doesNotMatch(line, /\bpin\b/);
  }
});

// --- no raw session token handling ---

test("the client form never references a session token, cookie name, or Set-Cookie", () => {
  for (const source of [formSource, pageSource]) {
    assert.doesNotMatch(source, /rawToken/);
    assert.doesNotMatch(source, /nia_member_session/);
    assert.doesNotMatch(source, /[Ss]et-[Cc]ookie/);
  }
});

test("the circle placeholder page authorizes only on the server (no \"use client\" directive)", () => {
  const rawCirclePageSource = readHere("../circles/[circleId]/page.tsx");
  assert.doesNotMatch(rawCirclePageSource, /^"use client";?/m);
  // It authorizes via requireCircleMember (7H.1), which itself reads the
  // session cookie server-side -- that never reaches client JavaScript
  // from here.
  assert.match(circlePageSource, /requireCircleMember/);
});

// --- no platform Auth.js dependency ---

test("neither the member login screen nor the circle placeholder imports platform Auth.js", () => {
  for (const source of [formSource, pageSource, circlePageSource]) {
    assert.doesNotMatch(source, /next-auth/);
    assert.doesNotMatch(source, /["']@\/auth["']/);
  }
});

test("the member login route is separate from the platform login route", () => {
  // The route file lives under app/member/login, distinct from app/login --
  // this pins that it never imports the platform login screen's own
  // component (a default-exported "LoginForm", not this ticket's
  // "MemberLoginForm").
  assert.doesNotMatch(pageSource, /from ["']@\/app\/login/);
  assert.doesNotMatch(pageSource, /\bimport LoginForm\b/);
});
