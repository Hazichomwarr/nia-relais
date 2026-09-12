import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("./circle-index.tsx", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../../../src/services/circle-owner-index.service.ts", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("../../../src/repositories/circle-owner-index.repository.ts", import.meta.url), "utf8");

test("/circles derives owner scope only from requireUser", () => {
  assert.match(pageSource, /requireUser\(\)/);
  assert.match(pageSource, /getCirclesForOwnerIndex\(user\.id\)/);
  assert.match(repositorySource, /where: \{ ownerId, status:/);
});

test("the index renders only DRAFT, ACTIVE, and COMPLETED owner circles with safe card summaries", () => {
  assert.match(viewSource, /\["DRAFT", "ACTIVE", "COMPLETED"\]/);
  assert.match(viewSource, /circle\.name/);
  assert.match(viewSource, /circle\.memberCount/);
  assert.match(viewSource, /circle\.contributionAmount/);
  assert.match(viewSource, /Open circle/);
  assert.match(viewSource, /\+ Create a circle/);
  assert.match(viewSource, /href="\/circles\/new"/);
});

test("active index context is a persisted round preview, not a financial or lifecycle eligibility calculation", () => {
  assert.match(serviceSource, /item\.status === "ACTIVE"/);
  assert.match(serviceSource, /item\.status === "UPCOMING"/);
  assert.doesNotMatch(serviceSource, /canAdvance|canStart|computeExpected|Decimal|ContributionObligation/);
});
