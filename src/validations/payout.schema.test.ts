import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { confirmPayoutSchema, disputePayoutSchema, recordPayoutSchema } from "./payout.schema";

const VALID_RECORD_INPUT = {
  roundId: "clx0000000000000000000001",
  amount: "100.00",
  clientOperationId: "owner-op-abc123",
};

test("a valid record input parses successfully", () => {
  const result = recordPayoutSchema.safeParse(VALID_RECORD_INPUT);
  assert.equal(result.success, true);
});

test("a valid confirm input parses successfully", () => {
  const result = confirmPayoutSchema.safeParse({ payoutId: "clx0000000000000000000002" });
  assert.equal(result.success, true);
});

test("a valid dispute input parses successfully", () => {
  const result = disputePayoutSchema.safeParse({
    payoutId: "clx0000000000000000000002",
    disputeReason: "I never received this payout.",
  });
  assert.equal(result.success, true);
});

test("malformed roundId (disallowed characters) is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, roundId: "not a valid id!" });
  assert.equal(result.success, false);
});

test("empty roundId is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, roundId: "" });
  assert.equal(result.success, false);
});

test("malformed payoutId (disallowed characters) is rejected for confirm and dispute", () => {
  assert.equal(confirmPayoutSchema.safeParse({ payoutId: "../etc/passwd" }).success, false);
  assert.equal(
    disputePayoutSchema.safeParse({ payoutId: "bad id", disputeReason: "reason" }).success,
    false,
  );
});

test("zero amount is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "0.00" });
  assert.equal(result.success, false);
});

test("negative amount is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "-10.00" });
  assert.equal(result.success, false);
});

test("non-numeric amount is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "abc" });
  assert.equal(result.success, false);
});

test("excessive Decimal precision (more than 2 decimal places) is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "10.999" });
  assert.equal(result.success, false);
});

test("an amount whose whole part exceeds DECIMAL(18,2)'s 16-digit capacity is rejected", () => {
  const result = recordPayoutSchema.safeParse({
    ...VALID_RECORD_INPUT,
    amount: "12345678901234567.00",
  });
  assert.equal(result.success, false);
});

test("an amount with a valid, in-range whole part and two decimal places is accepted", () => {
  const result = recordPayoutSchema.safeParse({
    ...VALID_RECORD_INPUT,
    amount: "9999999999999999.99",
  });
  assert.equal(result.success, true);
});

test("empty clientOperationId is rejected", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, clientOperationId: "" });
  assert.equal(result.success, false);
});

test("an over-length clientOperationId is rejected", () => {
  const result = recordPayoutSchema.safeParse({
    ...VALID_RECORD_INPUT,
    clientOperationId: "x".repeat(201),
  });
  assert.equal(result.success, false);
});

test("a whitespace-only clientOperationId is rejected after trimming", () => {
  const result = recordPayoutSchema.safeParse({ ...VALID_RECORD_INPUT, clientOperationId: "   " });
  assert.equal(result.success, false);
});

test("empty dispute reason is rejected", () => {
  const result = disputePayoutSchema.safeParse({
    payoutId: "clx0000000000000000000002",
    disputeReason: "",
  });
  assert.equal(result.success, false);
});

test("a whitespace-only dispute reason is rejected after trimming", () => {
  const result = disputePayoutSchema.safeParse({
    payoutId: "clx0000000000000000000002",
    disputeReason: "   ",
  });
  assert.equal(result.success, false);
});

test("an over-length dispute reason is rejected", () => {
  const result = disputePayoutSchema.safeParse({
    payoutId: "clx0000000000000000000002",
    disputeReason: "x".repeat(501),
  });
  assert.equal(result.success, false);
});

test("no schema accepts circleId, recipientId, memberId, currency, status, actor IDs, timestamps, or the expected payout amount -- only whitelisted keys are ever read", () => {
  const forbiddenFields = {
    circleId: "some-circle",
    recipientId: "some-member",
    memberId: "some-member",
    ownerId: "some-owner",
    status: "CONFIRMED",
    recordedById: "some-user",
    confirmedByMemberId: "some-member",
    disputedByMemberId: "some-member",
    recordedAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-01T00:00:00.000Z",
    disputedAt: "2026-01-01T00:00:00.000Z",
    currency: "USD",
    expectedPayoutAmount: "1.00",
    roundStatus: "ACTIVE",
  };

  const recordResult = recordPayoutSchema.parse({ ...VALID_RECORD_INPUT, ...forbiddenFields });
  assert.deepEqual(Object.keys(recordResult).sort(), ["amount", "clientOperationId", "roundId"]);

  const confirmResult = confirmPayoutSchema.parse({
    payoutId: "clx0000000000000000000002",
    ...forbiddenFields,
  });
  assert.deepEqual(Object.keys(confirmResult), ["payoutId"]);

  const disputeResult = disputePayoutSchema.parse({
    payoutId: "clx0000000000000000000002",
    disputeReason: "reason",
    ...forbiddenFields,
  });
  assert.deepEqual(Object.keys(disputeResult).sort(), ["disputeReason", "payoutId"]);
});

// --- architecture: round-lifecycle separation and no member-auth dependency (7K.2 section 11) ---

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSource = readFileSync(new URL("./payout.schema.ts", import.meta.url), "utf8");
const strippedSource = stripComments(rawSource);

test("this module's code never references PayoutRound status/lifecycle concepts", () => {
  for (const forbidden of ["PayoutRoundStatus", "roundStatus", "closeRound", "activateRound", "completeCircle"]) {
    assert.ok(!strippedSource.includes(forbidden), `expected no code reference to "${forbidden}"`);
  }
});

test("this module has no member-auth, Prisma client, service, or repository dependency -- pure Zod schemas only", () => {
  for (const forbidden of ["requireCircleMember", "validateCircleMemberSession", "nia_member_session"]) {
    assert.ok(!strippedSource.includes(forbidden), `expected no reference to "${forbidden}"`);
  }
  assert.doesNotMatch(strippedSource, /@prisma\/client/);
  assert.doesNotMatch(strippedSource, /from ["']@\/src\/services/);
  assert.doesNotMatch(strippedSource, /from ["']@\/src\/repositories/);
  assert.doesNotMatch(strippedSource, /"server-only"/);
});

test("the intended future service call shapes are documented, not implemented -- no exported function beyond the schemas/types", () => {
  assert.match(rawSource, /recordPayout\(\{ ownerId, circleId, input: RecordPayoutInput \}\)/);
  assert.match(rawSource, /confirmPayout\(\{ circleId, memberId, input: ConfirmPayoutInput \}\)/);
  assert.match(rawSource, /disputePayout\(\{ circleId, memberId, input: DisputePayoutInput \}\)/);
  assert.doesNotMatch(strippedSource, /^export (async )?function/m);
});
