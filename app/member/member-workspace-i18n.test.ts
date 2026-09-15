import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const source = [
  "./login/member-login-form.tsx",
  "./circles/[circleId]/member-dashboard.tsx",
  "./circles/[circleId]/member-payout-card.tsx",
  "./circles/[circleId]/member-payout-controls.tsx",
  "./circles/[circleId]/loading.tsx",
].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");

test("member workspace dictionary provides canonical EN/FR financial terminology", () => {
  assert.equal(en.memberWorkspace.contribution, "Contribution");
  assert.equal(fr.memberWorkspace.contribution, "Cotisation");
  assert.equal(en.memberWorkspace.myPayout, "My payout");
  assert.equal(fr.memberWorkspace.myPayout, "Mon versement");
  assert.equal(en.memberWorkspace.recipient, "Recipient");
  assert.equal(fr.memberWorkspace.recipient, "Bénéficiaire");
  assert.equal(en.memberWorkspace.round, "Round");
  assert.equal(fr.memberWorkspace.round, "Tour");
});

test("member presentation uses typed dictionary copy without changing user or financial values", () => {
  assert.match(source, /dictionary\.memberWorkspace|const copy = dictionary\.memberWorkspace/);
  for (const value of ["dashboard.circle.name", "dashboard.member.displayName", "circle.currency", "contributionAmount", "memberCode"]) {
    assert.ok(source.includes(value), `expected preserved value ${value}`);
  }
  assert.doesNotMatch(source, /memberWorkspace\.[a-z]+\s*\?\?/);
});

test("member loading and safe payout errors are localized at the presentation boundary", () => {
  assert.match(source, /dictionary\.memberWorkspace\.loadingCircle/);
  assert.match(source, /copy\.genericActionError/);
  assert.match(source, /localizeMemberFormError/);
});
