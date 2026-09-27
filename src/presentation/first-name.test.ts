import assert from "node:assert/strict";
import test from "node:test";

import { getFirstName } from "./first-name";

test("gets the first usable name without changing the stored display name", () => {
  assert.equal(getFirstName("Hamza Mare"), "Hamza");
  assert.equal(getFirstName("  Aichou   Tiemtore  "), "Aichou");
});

test("returns null rather than malformed greeting content for blank names", () => {
  assert.equal(getFirstName("   "), null);
  assert.equal(getFirstName(undefined), null);
});
