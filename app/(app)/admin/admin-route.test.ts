import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const routeSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../app-navigation.tsx", import.meta.url), "utf8");
const appLayoutSource = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../dashboard/page.tsx", import.meta.url), "utf8");

test("the admin route authorizes on the server before rendering founder content", () => {
  assert.match(routeSource, /await requireSuperAdmin\(\)/);
  assert.match(routeSource, /getFounderMetrics\(\)/);
  assert.match(routeSource, /PageBackLink href="\/dashboard"/);
  assert.match(routeSource, /dictionary\.admin\.title/);
  assert.match(routeSource, /href="\/admin\/users"/);
});

test("administration navigation is conditional, localized, and has no member equivalent", () => {
  assert.match(navigationSource, /showAdministration \? \[\{ href: "\/admin", label: dictionary\.common\.administration/);
  assert.equal(en.common.administration, "Administration");
  assert.equal(fr.common.administration, "Administration");
});

test("ordinary authenticated users retain Home access without a super-admin route guard", () => {
  assert.match(appLayoutSource, /requireUser\(\)/);
  assert.match(dashboardSource, /requireUser\(\)/);
  assert.doesNotMatch(dashboardSource, /requireSuperAdmin/);
});
