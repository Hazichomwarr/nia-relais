import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

test("keeps platform email/password sign-in separate from SUSU member sign-in", () => {
  assert.match(source, /name="email"/);
  assert.match(source, /name="password"/);
  assert.match(source, /Member sign-in is separate from your NIA account/);
  assert.match(source, /Circle ID, member code, and PIN/);
});

test("makes the separate member-login route discoverable from platform login", () => {
  assert.match(source, /href="\/member\/login"/);
  assert.match(source, />\s*Sign in as a SUSU member\s*</);
});
