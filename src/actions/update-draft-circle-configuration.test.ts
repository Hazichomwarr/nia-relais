import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DraftCircleConfigurationAuthorizationError,
  DraftCircleConfigurationConflictError,
  InvalidDraftCircleError,
} from "@/src/services/circle.service";
import {
  runUpdateDraftCircleConfigurationAction,
  type TrustedOwner,
  type UpdateDraftCircleConfigurationDependencies,
} from "@/src/actions/update-draft-circle-configuration";

const owner: TrustedOwner = { id: "owner-1", name: "Owner" };

function validForm(overrides: Partial<Record<string, string>> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    circleId: "circle-1",
    name: "Updated circle",
    currency: "EUR",
    contributionAmount: "42.50",
    frequency: "WEEKLY",
    startDate: "2099-01-01",
    ...overrides,
  })) form.set(key, value);
  return form;
}

function dependencies(overrides: Partial<UpdateDraftCircleConfigurationDependencies> = {}) {
  let captured: unknown;
  const deps: UpdateDraftCircleConfigurationDependencies = {
    requireUser: async () => owner,
    updateDraftCircleConfiguration: async (input) => {
      captured = input;
      return {
        id: input.circleId,
        name: String(input.input.name),
        currency: String(input.input.currency),
        contributionAmount: String(input.input.contributionAmount),
        frequency: String(input.input.frequency),
        startDate: String(input.input.startDate),
        status: "DRAFT",
        originKind: input.originKind,
        historicalCompletedRoundCount: input.originKind === "IMPORTED" ? Number(input.input.historicalCompletedRoundCount) : 0,
      };
    },
    ...overrides,
  };
  return { deps, captured: () => captured };
}

test("owner-authenticated normal DRAFT terms are passed through as one canonical update", async () => {
  const { deps, captured } = dependencies();
  const result = await runUpdateDraftCircleConfigurationAction(validForm({ ownerId: "forged" }), deps);
  assert.equal(result.status, "success");
  assert.deepEqual(captured(), {
    ownerId: "owner-1",
    circleId: "circle-1",
    originKind: "NEW",
    input: { name: "Updated circle", currency: "EUR", contributionAmount: "42.50", frequency: "WEEKLY", startDate: "2099-01-01" },
  });
});

// 9D.1: the canonical DRAFT editing operation now also serves IMPORTED
// circles through this same action/service/repository path (never a
// second, parallel import editor -- freeze §3/§9).
test("an IMPORTED circle's owner-submitted originKind selects IMPORTED validation and is forwarded, never silently dropped", async () => {
  const { deps, captured } = dependencies();
  const result = await runUpdateDraftCircleConfigurationAction(
    validForm({
      originKind: "IMPORTED",
      startDate: "2000-01-01",
      historicalCompletedRoundCount: "3",
      historicalTermsConfirmed: "on",
    }),
    deps,
  );
  assert.equal(result.status, "success");
  assert.deepEqual(captured(), {
    ownerId: "owner-1",
    circleId: "circle-1",
    originKind: "IMPORTED",
    input: {
      name: "Updated circle",
      currency: "EUR",
      contributionAmount: "42.50",
      frequency: "WEEKLY",
      startDate: "2000-01-01",
      historicalCompletedRoundCount: "3",
      historicalTermsConfirmed: "on",
    },
  });
});

test("an IMPORTED edit missing the term-consistency acknowledgement fails validation before the service is ever called", async () => {
  const { deps } = dependencies();
  const result = await runUpdateDraftCircleConfigurationAction(
    validForm({ originKind: "IMPORTED", startDate: "2000-01-01", historicalCompletedRoundCount: "3" }),
    deps,
  );
  assert.ok(result.fieldErrors?.historicalTermsConfirmed);
});

test("an IMPORTED edit reporting K=0 is rejected -- zero history is never a valid import edit", async () => {
  const { deps } = dependencies();
  const result = await runUpdateDraftCircleConfigurationAction(
    validForm({ originKind: "IMPORTED", startDate: "2000-01-01", historicalCompletedRoundCount: "0", historicalTermsConfirmed: "on" }),
    deps,
  );
  assert.ok(result.fieldErrors?.historicalCompletedRoundCount);
});

test("a circle whose actual persisted origin does not match the submitted originKind is refused, not applied under the wrong rules", async () => {
  const mismatched = dependencies({
    updateDraftCircleConfiguration: async () => { throw new DraftCircleConfigurationConflictError(); },
  });
  const result = await runUpdateDraftCircleConfigurationAction(
    validForm({ originKind: "IMPORTED", startDate: "2000-01-01", historicalCompletedRoundCount: "3", historicalTermsConfirmed: "on" }),
    mismatched.deps,
  );
  assert.equal(result.formError, "Circle details can only be changed while this new circle is still a draft.");
});

test("creation and normal-DRAFT edit validation remain aligned", async () => {
  const { deps } = dependencies();
  for (const invalid of [{ currency: "JPY" }, { contributionAmount: "0" }, { frequency: "DAILY" }, { startDate: "2000-01-01" }]) {
    const result = await runUpdateDraftCircleConfigurationAction(validForm(invalid), deps);
    assert.ok(result.fieldErrors);
  }
});

test("authorization, DRAFT-only conflicts, and safe validation errors map without leakage", async () => {
  const denied = dependencies({ updateDraftCircleConfiguration: async () => { throw new DraftCircleConfigurationAuthorizationError(); } });
  assert.equal((await runUpdateDraftCircleConfigurationAction(validForm(), denied.deps)).formError, "We could not find this circle.");
  const conflict = dependencies({ updateDraftCircleConfiguration: async () => { throw new DraftCircleConfigurationConflictError(); } });
  assert.equal((await runUpdateDraftCircleConfigurationAction(validForm(), conflict.deps)).formError, "Circle details can only be changed while this new circle is still a draft.");
  const invalid = dependencies({ updateDraftCircleConfiguration: async () => { throw new InvalidDraftCircleError("Start date cannot be in the past."); } });
  assert.equal((await runUpdateDraftCircleConfigurationAction(validForm(), invalid.deps)).formError, "Start date cannot be in the past.");
});

test("configuration update is lock-scoped and does not touch members, orders, or financial rows", () => {
  const service = readFileSync(new URL("../services/circle.service.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../repositories/circle.repository.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../app/(app)/circles/[circleId]/draft-circle-configuration-form.tsx", import.meta.url), "utf8");
  assert.match(service, /lockSavingsCircleForUpdate\(transaction, input\.circleId\)/);
  // 9D.1: the where clause is now a CAS against the caller's already
  // fresh-verified originKind (never a literal "NEW" -- both origins share
  // this one writer) -- still status/circleId-scoped, still never widened
  // to write origin itself.
  assert.match(repository, /where: \{ id: input\.circleId, status: "DRAFT", originKind: input\.originKind \}/);
  assert.doesNotMatch(repository.match(/export function updateDraftCircleConfigurationRecord[\s\S]*?\n\}/)?.[0] ?? "", /\.(circleMember|payoutRound|contributionObligation|contributionPayment|payout)\./);
  assert.match(ui, /dictionary\.draftCircleConfiguration/);
  assert.match(ui, /DRAFT_CIRCLE_CURRENCIES/);
});
