import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const notFoundSource = readFileSync(new URL("./not-found.tsx", import.meta.url), "utf8");
const dashboardLoadingSource = readFileSync(new URL("./(app)/dashboard/loading.tsx", import.meta.url), "utf8");
const emptyGoalsSource = readFileSync(new URL("./(app)/dashboard/empty-goals-state.tsx", import.meta.url), "utf8");
const goalLoadingSource = readFileSync(new URL("./(app)/goals/[goalId]/loading.tsx", import.meta.url), "utf8");
const circlePageSource = readFileSync(new URL("./(app)/circles/[circleId]/page.tsx", import.meta.url), "utf8");
const appNavigationSource = readFileSync(new URL("./(app)/app-navigation.tsx", import.meta.url), "utf8");
const recoveryPanelSource = readFileSync(new URL("./recovery-panel.tsx", import.meta.url), "utf8");

test("shared not-found and loading boundaries use EN/FR dictionary copy", () => {
  assert.equal(en.common.pageNotFound, "We couldn’t find that page.");
  assert.equal(fr.common.pageNotFound, "Cette page est introuvable.");
  assert.equal(en.common.loadingDashboard, "Loading your dashboard…");
  assert.equal(fr.common.loadingDashboard, "Chargement de votre tableau de bord…");
  assert.match(notFoundSource, /dictionary\.common\.pageNotFound/);
  assert.match(dashboardLoadingSource, /getDictionary\(await getLocale\(\)\)\.common\.loadingDashboard/);
  assert.match(goalLoadingSource, /dictionary\.personalSavings\.loadingSavingsRecord/);
});

test("empty-goal and circle metadata presentation is locale-aware", () => {
  assert.equal(en.dashboard.noGoalsYet, "You haven't started a goal yet.");
  assert.equal(fr.dashboard.noGoalsYet, "Vous n’avez pas encore commencé d’objectif.");
  assert.equal(en.dashboard.createFirstGoal, "Create my first goal");
  assert.equal(fr.dashboard.createFirstGoal, "Créer mon premier objectif");
  assert.match(emptyGoalsSource, /copy\.noGoalsYet/);
  assert.match(emptyGoalsSource, /copy\.createFirstGoal/);
  assert.match(circlePageSource, /generateMetadata/);
  assert.match(circlePageSource, /dictionary\.susuWorkspace\.circleWorkspace/);
  assert.doesNotMatch(circlePageSource, /Your circle · NIA/);
});

test("reachable accessibility and recovery copy is localized", () => {
  assert.equal(en.common.language, "Language");
  assert.equal(fr.common.language, "Langue");
  assert.equal(en.common.retry, "Try again");
  assert.equal(fr.common.retry, "Réessayer");
  assert.match(appNavigationSource, /dictionary\.common\.primaryNavigation/);
  assert.match(appNavigationSource, /dictionary\.common\.openNavigation/);
  assert.match(recoveryPanelSource, /\{retryLabel\}/);
  assert.doesNotMatch(recoveryPanelSource, />\s*Try again\s*</);
});
