import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_LOCALE, resolveLocale } from "./config";
import { en } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";

const switcherSource = readFileSync(new URL("../../components/i18n/language-switcher.tsx", import.meta.url), "utf8");
const landingSource = readFileSync(new URL("../../components/marketing/landing-hero.tsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../../app/login/login-form.tsx", import.meta.url), "utf8");
const memberLoginSource = readFileSync(new URL("../../app/member/login/member-login-form.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../../app/(app)/app-navigation.tsx", import.meta.url), "utf8");

test("French is the default and unsupported locale preferences safely fall back", () => {
  assert.equal(DEFAULT_LOCALE, "fr");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("fr"), "fr");
  assert.equal(resolveLocale("FR"), "fr");
  assert.equal(resolveLocale(undefined), "fr");
});

test("English and French dictionaries retain the same complete semantic shape", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(fr.common).sort(), Object.keys(en.common).sort());
  assert.deepEqual(Object.keys(fr.memberLogin).sort(), Object.keys(en.memberLogin).sort());
  assert.equal(fr.landing.titleFirst, "Petit à petit.");
  assert.equal(en.landing.titleFirst, "Small steps.");
});

test("the switcher persists a selected locale and refreshes without changing the route", () => {
  assert.match(switcherSource, /setLocaleAction\(nextLocale\)/);
  assert.match(switcherSource, /router\.refresh\(\)/);
  assert.doesNotMatch(switcherSource, /router\.(push|replace)\(/);
  assert.match(switcherSource, /aria-pressed/);
});

test("the foundation localizes landing, authentication, member access, and shared navigation", () => {
  assert.match(landingSource, /dictionary\.landing\.titleFirst/);
  assert.match(loginSource, /dictionary\.login\.memberTitle/);
  assert.match(memberLoginSource, /dictionary\.memberLogin\.circleCode/);
  assert.match(navigationSource, /dictionary\.common\.susuCircles/);
  assert.match(navigationSource, /dictionary\.common\.greeting/);
});

test("the dictionary does not mutate user-created content or persisted enum values", () => {
  const combined = `${JSON.stringify(en)}${JSON.stringify(fr)}`;
  assert.doesNotMatch(combined, /Africa Go Back Funds|Compaore Basil/);
  assert.equal(en.status.active, "Active");
  assert.equal(fr.status.active, "Actif");
});
