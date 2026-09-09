import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmContributionSchema,
  recordContributionSchema,
  rejectContributionSchema,
} from "./contribution.schema";

const VALID_RECORD_INPUT = {
  obligationId: "clx0000000000000000000001",
  amount: "100.00",
  clientOperationId: "owner-op-abc123",
};

test("a valid record input parses successfully", () => {
  const result = recordContributionSchema.safeParse(VALID_RECORD_INPUT);
  assert.equal(result.success, true);
});

test("a valid confirm input parses successfully", () => {
  const result = confirmContributionSchema.safeParse({ paymentId: "clx0000000000000000000002" });
  assert.equal(result.success, true);
});

test("a valid reject input parses successfully", () => {
  const result = rejectContributionSchema.safeParse({
    paymentId: "clx0000000000000000000002",
    rejectionReason: "Amount does not match what was handed over.",
  });
  assert.equal(result.success, true);
});

test("malformed obligationId (disallowed characters) is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, obligationId: "not a valid id!" });
  assert.equal(result.success, false);
});

test("empty obligationId is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, obligationId: "" });
  assert.equal(result.success, false);
});

test("malformed paymentId (disallowed characters) is rejected for confirm and reject", () => {
  assert.equal(confirmContributionSchema.safeParse({ paymentId: "../etc/passwd" }).success, false);
  assert.equal(
    rejectContributionSchema.safeParse({ paymentId: "bad id", rejectionReason: "reason" }).success,
    false,
  );
});

test("zero amount is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "0.00" });
  assert.equal(result.success, false);
});

test("negative amount is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "-10.00" });
  assert.equal(result.success, false);
});

test("non-numeric amount is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "abc" });
  assert.equal(result.success, false);
});

test("excessive Decimal precision (more than 2 decimal places) is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, amount: "10.999" });
  assert.equal(result.success, false);
});

test("an amount whose whole part exceeds DECIMAL(18,2)'s 16-digit capacity is rejected", () => {
  const result = recordContributionSchema.safeParse({
    ...VALID_RECORD_INPUT,
    amount: "12345678901234567.00",
  });
  assert.equal(result.success, false);
});

test("an amount with a valid, in-range whole part and two decimal places is accepted", () => {
  const result = recordContributionSchema.safeParse({
    ...VALID_RECORD_INPUT,
    amount: "9999999999999999.99",
  });
  assert.equal(result.success, true);
});

test("empty clientOperationId is rejected", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, clientOperationId: "" });
  assert.equal(result.success, false);
});

test("an over-length clientOperationId is rejected", () => {
  const result = recordContributionSchema.safeParse({
    ...VALID_RECORD_INPUT,
    clientOperationId: "x".repeat(201),
  });
  assert.equal(result.success, false);
});

test("a whitespace-only clientOperationId is rejected after trimming", () => {
  const result = recordContributionSchema.safeParse({ ...VALID_RECORD_INPUT, clientOperationId: "   " });
  assert.equal(result.success, false);
});

test("empty rejection reason is rejected", () => {
  const result = rejectContributionSchema.safeParse({
    paymentId: "clx0000000000000000000002",
    rejectionReason: "",
  });
  assert.equal(result.success, false);
});

test("a whitespace-only rejection reason is rejected after trimming", () => {
  const result = rejectContributionSchema.safeParse({
    paymentId: "clx0000000000000000000002",
    rejectionReason: "   ",
  });
  assert.equal(result.success, false);
});

test("an over-length rejection reason is rejected", () => {
  const result = rejectContributionSchema.safeParse({
    paymentId: "clx0000000000000000000002",
    rejectionReason: "x".repeat(501),
  });
  assert.equal(result.success, false);
});

test("no schema accepts ownerId, status, actor IDs, timestamps, currency, or expectedAmount -- only whitelisted keys are ever read", () => {
  const forbiddenFields = {
    ownerId: "some-owner",
    status: "CONFIRMED",
    recordedById: "some-user",
    confirmedById: "some-user",
    rejectedById: "some-user",
    recordedAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-01T00:00:00.000Z",
    currency: "USD",
    expectedAmount: "1.00",
  };

  const recordResult = recordContributionSchema.parse({ ...VALID_RECORD_INPUT, ...forbiddenFields });
  assert.deepEqual(Object.keys(recordResult).sort(), ["amount", "clientOperationId", "obligationId"]);

  const confirmResult = confirmContributionSchema.parse({
    paymentId: "clx0000000000000000000002",
    ...forbiddenFields,
  });
  assert.deepEqual(Object.keys(confirmResult), ["paymentId"]);

  const rejectResult = rejectContributionSchema.parse({
    paymentId: "clx0000000000000000000002",
    rejectionReason: "reason",
    ...forbiddenFields,
  });
  assert.deepEqual(Object.keys(rejectResult).sort(), ["paymentId", "rejectionReason"]);
});
