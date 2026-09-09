import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./app-navigation.tsx", import.meta.url), "utf8");

test("AppNavigation includes a SUSU circles entry pointing at the create-circle route", () => {
  assert.match(source, /label:\s*"SUSU circles"/);
  assert.match(source, /href:\s*"\/circles\/new"/);
});

test("the existing nav items (Dashboard, My savings, Trusted person) are unchanged", () => {
  assert.match(source, /label:\s*"Dashboard"/);
  assert.match(source, /label:\s*"My savings"/);
  assert.match(source, /label:\s*"Trusted person"/);
});
