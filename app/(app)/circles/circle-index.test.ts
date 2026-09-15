import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("./circle-index.tsx", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../../../src/services/circle-owner-index.service.ts", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("../../../src/repositories/circle-owner-index.repository.ts", import.meta.url), "utf8");

test("/circles derives owner scope only from requireUser", () => {
  assert.match(pageSource, /requireUser\(\)/);
  assert.match(pageSource, /getCirclesForOwnerIndex\(user\.id, \{ includeRetired: historyView \}\)/);
  assert.match(repositorySource, /where: \{ ownerId, status:/);
});

test("the index renders DRAFT, ACTIVE, and COMPLETED owner circles in one safe card list", () => {
  assert.match(viewSource, /\["DRAFT", "ACTIVE", "COMPLETED"\]/);
  assert.match(viewSource, /circle\.name/);
  assert.match(viewSource, /circle\.memberCount/);
  assert.match(viewSource, /circle\.contributionAmount/);
  assert.match(viewSource, /copy\.openCircle/);
  assert.match(viewSource, /copy\.viewCircle/);
  assert.match(viewSource, /copy\.createCircle/);
  assert.match(viewSource, /href="\/circles\/new"/);
  assert.match(viewSource, /formatContributionMoney/);
  assert.doesNotMatch(viewSource, /memberCode/);
  assert.doesNotMatch(viewSource, /<h2 id=\{`\$\{group\.status/);
});

test("cards use only authoritative persisted member and current-round preview data", () => {
  assert.match(viewSource, /circle\.memberCount/);
  assert.match(viewSource, /circle\.currentOrNextRound/);
  assert.match(viewSource, /round\.roundNumber/);
  assert.match(viewSource, /round\.recipientDisplayName/);
  assert.match(viewSource, /round\.dueDate/);
  assert.doesNotMatch(viewSource, /Math\.random|new Date\(\)/);
});

test("the index has accessible empty and singular\/plural count states", () => {
  assert.equal(en.susu.openCircle, "Open circle");
  assert.equal(fr.susu.openCircle, "Ouvrir le cercle");
  assert.equal(en.susu.firstCta, "Create your first circle");
  assert.equal(fr.susu.firstCta, "Créer mon premier cercle");
  assert.match(viewSource, /copy\.circleCountOne/);
  assert.match(viewSource, /copy\.circleCountMany/);
});

test("active index context is a persisted round preview, not a financial or lifecycle eligibility calculation", () => {
  assert.match(serviceSource, /item\.status === "ACTIVE"/);
  assert.match(serviceSource, /item\.status === "UPCOMING"/);
  assert.doesNotMatch(serviceSource, /canAdvance|canStart|computeExpected|Decimal|ContributionObligation/);
});
