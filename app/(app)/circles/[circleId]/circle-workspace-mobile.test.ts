import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const navigationSource = readFileSync(new URL("./circle-workspace-navigation.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("./circle-workspace-overview.tsx", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("./circle-schedule.tsx", import.meta.url), "utf8");

test("the mobile workspace nav contains its own horizontal scrolling", () => {
  assert.match(navigationSource, /w-full min-w-0 shrink-0/);
  assert.match(navigationSource, /max-w-full gap-2 overflow-x-auto overscroll-x-contain/);
  assert.match(navigationSource, /shrink-0 whitespace-nowrap/);
  assert.match(navigationSource, /md:hidden/);
  assert.match(navigationSource, /hidden[\s\S]*md:block/);
});

test("overview uses stacked mobile metrics and a shrink-safe current recipient", () => {
  assert.match(overviewSource, /border-t border-\[#e7ded1\][\s\S]*sm:border-t-0 sm:border-l/);
  assert.match(overviewSource, /grid border-b border-\[#e2d7c9\] py-6 sm:grid-cols-4/);
  assert.match(overviewSource, /flex flex-col items-start gap-3 sm:mt-7 sm:flex-row/);
  assert.match(overviewSource, /break-words text-xl font-semibold sm:text-2xl/);
  assert.doesNotMatch(overviewSource, /truncate text-lg font-semibold/);
});

test("long recipient names stay available in overview and schedule previews", () => {
  assert.match(overviewSource, /grid grid-cols-\[auto_minmax\(0,1fr\)\]/);
  assert.match(overviewSource, /break-words text-sm font-medium/);
  assert.match(scheduleSource, /grid grid-cols-\[auto_minmax\(0,1fr\)\]/);
  assert.match(scheduleSource, /break-words font-semibold/);
});
