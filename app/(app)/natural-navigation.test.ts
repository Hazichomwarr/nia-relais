import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = source("./dashboard/page.tsx");
const savings = source("./deposits/page.tsx");
const circles = source("./circles/circle-index.tsx");
const custodian = source("./custodian/page.tsx");
const goal = source("./goals/[goalId]/deposits/page.tsx");
const newDeposit = source("./goals/[goalId]/deposits/new/page.tsx");
const newGoal = source("./goals/new/new-goal-form.tsx");
const newCircle = source("./circles/new/new-circle-form.tsx");
const circleWorkspace = source("./circles/[circleId]/circle-workspace-navigation.tsx");
const memberWorkspace = readFileSync(new URL("../member/circles/[circleId]/page.tsx", import.meta.url), "utf8");

test("Home uses a presentation-only first-name greeting with typed EN/FR copy", () => {
  assert.equal(en.dashboard.homeGreeting, "Good to see you");
  assert.equal(fr.dashboard.homeGreeting, "Ravi de te revoir");
  assert.match(dashboard, /getFirstName\(user\.name\)/);
  assert.match(dashboard, /\$\{copy\.homeGreeting\}, \$\{firstName\}\./);
  assert.doesNotMatch(dashboard, /heroWelcomeBack\}, \{user\.name\}/);
});

test("destination roots use deterministic Home links", () => {
  for (const page of [savings, circles, custodian]) {
    assert.match(page, /PageBackLink href="\/dashboard" label=\{dictionary\.common\.dashboard\}/);
  }
});

test("nested platform screens point to their product parent", () => {
  assert.match(goal, /PageBackLink href="\/deposits" label=\{dictionary\.common\.mySavings\}/);
  assert.match(newDeposit, /PageBackLink href=\{`\/goals\/\$\{encodeURIComponent\(goal\.id\)\}\/deposits`\}/);
  assert.match(newGoal, /PageBackLink href="\/deposits" label=\{dictionary\.common\.mySavings\}/);
  assert.match(newCircle, /PageBackLink href="\/circles" label=\{dictionary\.common\.susuCircles\}/);
  assert.match(circleWorkspace, /PageBackLink href="\/circles" label=\{dictionary\.common\.susuCircles\}/);
});

test("Home stays root-level and member navigation never crosses into platform Home", () => {
  assert.doesNotMatch(dashboard, /PageBackLink/);
  assert.doesNotMatch(memberWorkspace, /\/dashboard/);
});
