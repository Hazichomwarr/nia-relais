import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import {
  amountMatchesObligation,
  clampToZero,
  isObligationFulfilled,
  toMoney,
} from "./contribution-accounting";

test("toMoney formats a Decimal to a fixed-2 string, never a JS number", () => {
  assert.equal(toMoney(new Prisma.Decimal("10")), "10.00");
  assert.equal(toMoney(new Prisma.Decimal("10.5")), "10.50");
  assert.equal(toMoney(new Prisma.Decimal("0")), "0.00");
});

test("toMoney has no floating-point drift on values JS floats cannot represent exactly", () => {
  // 0.1 + 0.2 famously does not equal 0.3 in JS floating-point arithmetic.
  // Decimal must not exhibit that drift.
  const sum = new Prisma.Decimal("0.1").plus(new Prisma.Decimal("0.2"));
  assert.equal(toMoney(sum), "0.30");
  assert.notEqual(0.1 + 0.2, 0.3);
});

test("clampToZero leaves non-negative Decimals untouched", () => {
  const value = new Prisma.Decimal("42.17");
  assert.ok(clampToZero(value).equals(value));
  assert.ok(clampToZero(new Prisma.Decimal("0")).equals(new Prisma.Decimal("0")));
});

test("clampToZero floors a negative Decimal to exactly zero", () => {
  const result = clampToZero(new Prisma.Decimal("-5.00"));
  assert.ok(result.equals(new Prisma.Decimal("0")));
});

test("amountMatchesObligation is true only for an exact Decimal match", () => {
  const expected = new Prisma.Decimal("100.00");
  assert.equal(amountMatchesObligation(new Prisma.Decimal("100.00"), expected), true);
  assert.equal(amountMatchesObligation(new Prisma.Decimal("100"), expected), true);
  assert.equal(amountMatchesObligation(new Prisma.Decimal("99.99"), expected), false);
  assert.equal(amountMatchesObligation(new Prisma.Decimal("100.01"), expected), false);
});

test("amountMatchesObligation rejects both underpayment and overpayment -- V1 has no partial/overpayment concept", () => {
  const expected = new Prisma.Decimal("50.00");
  assert.equal(amountMatchesObligation(new Prisma.Decimal("25.00"), expected), false);
  assert.equal(amountMatchesObligation(new Prisma.Decimal("75.00"), expected), false);
});

test("isObligationFulfilled is true once confirmed reaches expected, false below it", () => {
  const expected = new Prisma.Decimal("100.00");
  assert.equal(isObligationFulfilled(new Prisma.Decimal("0"), expected), false);
  assert.equal(isObligationFulfilled(new Prisma.Decimal("99.99"), expected), false);
  assert.equal(isObligationFulfilled(new Prisma.Decimal("100.00"), expected), true);
});

test("isObligationFulfilled remains true if confirmed somehow exceeds expected (defensive, not a V1-reachable state)", () => {
  assert.equal(
    isObligationFulfilled(new Prisma.Decimal("150.00"), new Prisma.Decimal("100.00")),
    true,
  );
});
