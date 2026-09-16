import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMemberCircleHref,
  buildMemberLoginRequestPayload,
  validateMemberLoginForm,
} from "./member-login-form.logic";

const VALID_VALUES = { circleCode: "NIA-7K42", memberCode: "abcdef0123456789", pin: "123456" };

// --- form validation ---

test("valid values produce no field errors", () => {
  const errors = validateMemberLoginForm(VALID_VALUES);
  assert.deepEqual(errors, {});
});

test("an empty circleCode is rejected", () => {
  const errors = validateMemberLoginForm({ ...VALID_VALUES, circleCode: "   " });
  assert.ok(errors.circleCode);
});

// 10E: a legacy raw circle id (issued before circleCode existed) must still
// pass this client-side check -- the server, not this function, decides
// which shape a non-empty value actually is.
test("a non-empty legacy circle id also passes client-side validation", () => {
  const errors = validateMemberLoginForm({ ...VALID_VALUES, circleCode: "cabc123def456ghi789jklmno" });
  assert.equal(errors.circleCode, undefined);
});

test("a member code that isn't 16 hex characters or a valid 6-character code is rejected", () => {
  const tooShort = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "ABC" });
  const ambiguousChars = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "I0O1L1" });
  assert.ok(tooShort.memberCode);
  assert.ok(ambiguousChars.memberCode);
});

test("a lowercase, otherwise-valid legacy 16-character member code passes (case is normalized before checking)", () => {
  const errors = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "abcdef0123456789" });
  assert.equal(errors.memberCode, undefined);
});

test("a lowercase, otherwise-valid new 6-character member code passes (case is normalized before checking)", () => {
  const errors = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "k7m4q8" });
  assert.equal(errors.memberCode, undefined);
});

test("a PIN that isn't exactly 6 digits is rejected", () => {
  const tooShort = validateMemberLoginForm({ ...VALID_VALUES, pin: "123" });
  const nonNumeric = validateMemberLoginForm({ ...VALID_VALUES, pin: "12345a" });
  assert.ok(tooShort.pin);
  assert.ok(nonNumeric.pin);
});

// --- correct request payload ---

test("the request payload contains exactly circleCode, memberCode, and pin -- nothing else", () => {
  const payload = buildMemberLoginRequestPayload(VALID_VALUES);
  assert.deepEqual(Object.keys(payload).sort(), ["circleCode", "memberCode", "pin"]);
});

test("the request payload trims circleCode and pin, and trims+uppercases memberCode -- circleCode's own case is left for the server to classify", () => {
  const payload = buildMemberLoginRequestPayload({
    circleCode: "  nia-7k42  ",
    memberCode: "  abcdef0123456789  ",
    pin: "  123456  ",
  });

  assert.deepEqual(payload, {
    circleCode: "nia-7k42",
    memberCode: "ABCDEF0123456789",
    pin: "123456",
  });
});

// --- successful navigation target ---

test("the circle href is built from the given (server-resolved) circleId only, URL-encoded", () => {
  assert.equal(
    buildMemberCircleHref("cabc123def456ghi789jklmno"),
    "/member/circles/cabc123def456ghi789jklmno",
  );
  assert.equal(buildMemberCircleHref("weird/id?"), "/member/circles/weird%2Fid%3F");
});
