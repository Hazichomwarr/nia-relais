import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./circle-workspace-navigation.tsx", import.meta.url), "utf8");

test("local navigation names the owner workspace sections and defaults unknown values to Overview", () => {
  for (const section of ["overview", "contributions", "payouts", "members", "schedule"]) {
    assert.ok(source.includes(`"${section}"`));
  }
  assert.match(source, /: "overview"/);
});

test("desktop uses a contained local navigation while mobile uses compact horizontal navigation", () => {
  assert.match(source, /hidden[\s\S]*md:block/);
  assert.match(source, /md:hidden/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /whitespace-nowrap/);
});

test("navigation links stay inside the opened circle and mark the selected section", () => {
  assert.match(source, /`\/circles\/\$\{circleId\}`/);
  assert.match(source, /\?section=\$\{item\}/);
  assert.match(source, /aria-current=\{selected \? "page" : undefined\}/);
});
