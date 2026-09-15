import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney, getCurrencyDisplayCode } from "./format";

test("XOF remains canonical in code while displaying as CFA", () => {
  assert.equal(getCurrencyDisplayCode("XOF"), "CFA");
  assert.equal(formatMoney("25000.00", "XOF"), "CFA 25,000");
});

test("other V1 currency codes remain unchanged in presentation", () => {
  assert.equal(formatMoney("12.50", "USD"), "USD 12.50");
  assert.equal(formatMoney("12.50", "EUR"), "EUR 12.50");
  assert.equal(formatMoney("12.50", "GBP"), "GBP 12.50");
});
