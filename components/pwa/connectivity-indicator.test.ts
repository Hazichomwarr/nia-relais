import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("connectivity indicator starts absent and changes only through browser connectivity events", async () => {
  const source = await readFile("components/pwa/connectivity-indicator.tsx", "utf8");
  assert.match(source, /useState\(false\)/);
  assert.doesNotMatch(source, /!navigator\.onLine/);
  assert.match(source, /addEventListener\("offline"/);
  assert.match(source, /addEventListener\("online"/);
  assert.match(source, /removeEventListener\("offline"/);
  assert.match(source, /removeEventListener\("online"/);
  assert.match(source, /rounded-full/);
  assert.match(source, /safe-area-inset-top/);
});
