import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./app-navigation.tsx", import.meta.url), "utf8");

test("AppNavigation includes a localized SUSU circles entry pointing at the owner circle index", () => {
  assert.match(source, /label:\s*dictionary\.common\.susuCircles/);
  assert.match(source, /href:\s*"\/circles"/);
});

test("the existing nav destinations use typed shared dictionary labels", () => {
  assert.match(source, /label:\s*dictionary\.common\.dashboard/);
  assert.match(source, /label:\s*dictionary\.common\.mySavings/);
  assert.match(source, /label:\s*dictionary\.common\.trustedPerson/);
  assert.match(source, /<LanguageSwitcher locale=\{locale\}/);
});

test("mobile navigation is compact behind an accessible menu control", () => {
  assert.match(source, /aria-label="Open navigation"/);
  assert.match(source, /aria-controls="mobile-primary-navigation"/);
  assert.match(source, /sm:hidden/);
  assert.match(source, /id="mobile-primary-navigation"/);
});
