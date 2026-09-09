import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMemberCircleHref,
  buildMemberLoginRequestPayload,
  validateMemberLoginForm,
} from "./member-login-form.logic";

const VALID_VALUES = { circleId: "cabc123def456ghi789jklmno", memberCode: "abcdef0123456789", pin: "123456" };

// --- form validation ---

test("valid values produce no field errors", () => {
  const errors = validateMemberLoginForm(VALID_VALUES);
  assert.deepEqual(errors, {});
});

test("an empty circleId is rejected", () => {
  const errors = validateMemberLoginForm({ ...VALID_VALUES, circleId: "   " });
  assert.ok(errors.circleId);
});

test("a member code that isn't 16 hex characters is rejected, regardless of case", () => {
  const tooShort = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "ABC123" });
  const wrongChars = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "GHIJKLMNOPQRSTUV" });
  assert.ok(tooShort.memberCode);
  assert.ok(wrongChars.memberCode);
});

test("a lowercase, otherwise-valid member code passes (case is normalized before checking)", () => {
  const errors = validateMemberLoginForm({ ...VALID_VALUES, memberCode: "abcdef0123456789" });
  assert.equal(errors.memberCode, undefined);
});

test("a PIN that isn't exactly 6 digits is rejected", () => {
  const tooShort = validateMemberLoginForm({ ...VALID_VALUES, pin: "123" });
  const nonNumeric = validateMemberLoginForm({ ...VALID_VALUES, pin: "12345a" });
  assert.ok(tooShort.pin);
  assert.ok(nonNumeric.pin);
});

// --- correct request payload ---

test("the request payload contains exactly circleId, memberCode, and pin -- nothing else", () => {
  const payload = buildMemberLoginRequestPayload(VALID_VALUES);
  assert.deepEqual(Object.keys(payload).sort(), ["circleId", "memberCode", "pin"]);
});

test("the request payload trims circleId and pin, and trims+uppercases memberCode", () => {
  const payload = buildMemberLoginRequestPayload({
    circleId: "  cabc123def456ghi789jklmno  ",
    memberCode: "  abcdef0123456789  ",
    pin: "  123456  ",
  });

  assert.deepEqual(payload, {
    circleId: "cabc123def456ghi789jklmno",
    memberCode: "ABCDEF0123456789",
    pin: "123456",
  });
});

// --- successful navigation target ---

test("the circle href is built from the given circleId only, URL-encoded", () => {
  assert.equal(
    buildMemberCircleHref("cabc123def456ghi789jklmno"),
    "/member/circles/cabc123def456ghi789jklmno",
  );
  assert.equal(buildMemberCircleHref("weird/id?"), "/member/circles/weird%2Fid%3F");
});
