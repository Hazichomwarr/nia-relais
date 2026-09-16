import assert from "node:assert/strict";
import test from "node:test";

import {
  CIRCLE_CODE_PATTERN,
  classifyCircleLoginIdentifier,
  CUID_PATTERN,
  HUMAN_CODE_ALPHABET,
  LEGACY_MEMBER_CODE_PATTERN,
  MEMBER_CODE_LOGIN_PATTERN,
  MEMBER_CODE_PATTERN,
  verifyCircleMemberCredentialsSchema,
} from "./circle-member-auth.schema";

// Pure, DB-free tests for the 10E shape contract -- classification,
// normalization, and the union member-code pattern. Live-DB authentication
// behavior (does a given classified identifier actually resolve to a real
// circle/member) is covered separately in
// circle-member-auth.service.test.ts.

test("the restricted alphabet excludes every ambiguous character (0/O, 1/I/L)", () => {
  for (const ambiguous of ["0", "O", "1", "I", "L"]) {
    assert.ok(!HUMAN_CODE_ALPHABET.includes(ambiguous), `alphabet must not contain "${ambiguous}"`);
  }
  assert.equal(HUMAN_CODE_ALPHABET.length, 31);
  assert.equal(new Set(HUMAN_CODE_ALPHABET).size, 31, "every alphabet character must be unique");
});

// --- circleCode classification ---

test("a well-formed circleCode classifies as CIRCLE_CODE, uppercased", () => {
  const result = classifyCircleLoginIdentifier("NIA-7K42");
  assert.deepEqual(result, { kind: "CIRCLE_CODE", value: "NIA-7K42" });
});

test("circleCode classification is case-insensitive", () => {
  for (const input of ["nia-7k42", "Nia-7K42", "NIA-7k42"]) {
    assert.deepEqual(classifyCircleLoginIdentifier(input), { kind: "CIRCLE_CODE", value: "NIA-7K42" });
  }
});

test("circleCode classification tolerates leading/trailing whitespace", () => {
  assert.deepEqual(classifyCircleLoginIdentifier("  NIA-7K42  "), { kind: "CIRCLE_CODE", value: "NIA-7K42" });
  assert.deepEqual(classifyCircleLoginIdentifier("\tnia-7k42\n"), { kind: "CIRCLE_CODE", value: "NIA-7K42" });
});

test("circleCode classification rejects ambiguous characters (0, O, 1, I, L)", () => {
  for (const ambiguous of ["0", "O", "1", "I", "L"]) {
    const candidate = `NIA-${ambiguous}K42`;
    assert.equal(CIRCLE_CODE_PATTERN.test(candidate), false, `expected "${candidate}" to be rejected`);
  }
});

test("a legacy raw circle id classifies as LEGACY_CIRCLE_ID, lowercased", () => {
  const legacyId = "c" + "a".repeat(24);
  const result = classifyCircleLoginIdentifier(legacyId.toUpperCase());
  assert.deepEqual(result, { kind: "LEGACY_CIRCLE_ID", value: legacyId });
});

test("garbage that matches neither shape classifies as null", () => {
  for (const garbage of ["", "not-a-code", "NIA-12", "NIA-ABCDE", "c" + "a".repeat(23), "12345"]) {
    assert.equal(classifyCircleLoginIdentifier(garbage), null, `expected "${garbage}" to be unclassifiable`);
  }
});

test("CUID_PATTERN and CIRCLE_CODE_PATTERN are structurally disjoint -- no input can match both", () => {
  // A generative spot-check across the two shapes' own defining structure
  // (fixed "NIA-" prefix vs. a leading lowercase "c") rather than an
  // exhaustive search of an effectively infinite string space.
  const circleCodeSamples = ["NIA-7K42", "NIA-2222", "NIA-ZZZZ"];
  const legacyIdSamples = ["c" + "a".repeat(24), "c" + "0".repeat(24), "c" + "z".repeat(24)];

  for (const sample of circleCodeSamples) {
    assert.equal(CIRCLE_CODE_PATTERN.test(sample), true);
    assert.equal(CUID_PATTERN.test(sample), false);
  }
  for (const sample of legacyIdSamples) {
    assert.equal(CUID_PATTERN.test(sample), true);
    assert.equal(CIRCLE_CODE_PATTERN.test(sample), false);
  }
});

// --- memberCode union pattern ---

test("a legacy 16-character hex memberCode matches the login union pattern", () => {
  assert.equal(MEMBER_CODE_LOGIN_PATTERN.test("ABCDEF0123456789"), true);
  assert.equal(LEGACY_MEMBER_CODE_PATTERN.test("ABCDEF0123456789"), true);
});

test("a new 6-character restricted-alphabet memberCode matches the login union pattern", () => {
  assert.equal(MEMBER_CODE_LOGIN_PATTERN.test("K7M4Q8"), true);
  assert.equal(MEMBER_CODE_PATTERN.test("K7M4Q8"), true);
});

test("a new memberCode with an ambiguous character is rejected", () => {
  for (const ambiguous of ["0", "O", "1", "I", "L"]) {
    const candidate = `K7M4${ambiguous}8`;
    assert.equal(MEMBER_CODE_LOGIN_PATTERN.test(candidate), false, `expected "${candidate}" to be rejected`);
  }
});

test("a memberCode of the wrong length for either shape is rejected", () => {
  for (const wrongLength of ["K7M4Q", "K7M4Q8X", "ABCDEF012345678", "ABCDEF01234567890"]) {
    assert.equal(MEMBER_CODE_LOGIN_PATTERN.test(wrongLength), false, `expected "${wrongLength}" to be rejected`);
  }
});

// --- full schema parsing ---

test("verifyCircleMemberCredentialsSchema classifies circleCode, normalizes memberCode, and validates the PIN together", () => {
  const parsed = verifyCircleMemberCredentialsSchema.safeParse({
    circleCode: "nia-7k42",
    memberCode: "k7m4q8",
    pin: "012345",
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data.circleCode, { kind: "CIRCLE_CODE", value: "NIA-7K42" });
  assert.equal(parsed.data.memberCode, "K7M4Q8");
  assert.equal(parsed.data.pin, "012345", "a leading-zero PIN must be preserved exactly, not coerced numerically");
});

test("verifyCircleMemberCredentialsSchema rejects an unclassifiable circleCode", () => {
  const parsed = verifyCircleMemberCredentialsSchema.safeParse({
    circleCode: "not-a-real-code",
    memberCode: "K7M4Q8",
    pin: "123456",
  });
  assert.equal(parsed.success, false);
});

test("verifyCircleMemberCredentialsSchema rejects a PIN that is not exactly 6 digits", () => {
  for (const pin of ["12345", "1234567", "12345a"]) {
    const parsed = verifyCircleMemberCredentialsSchema.safeParse({
      circleCode: "NIA-7K42",
      memberCode: "K7M4Q8",
      pin,
    });
    assert.equal(parsed.success, false, `expected PIN "${pin}" to be rejected`);
  }
});
