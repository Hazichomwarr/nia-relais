import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Structural/source-inspection tests only, deliberately -- not live-fixture
// tests. Every other 9D.1-relevant DB-touching function (createDraftCircle,
// createImportedDraftCircle, updateDraftCircleConfiguration, activateCircle)
// is exercised through DI-mocked action-layer tests
// (src/actions/create-draft-circle.test.ts,
// src/actions/update-draft-circle-configuration.test.ts,
// src/actions/activate-circle.test.ts) or the pure domain fingerprint tests
// (src/domain/circle-activation-review.test.ts). This file covers what
// those cannot: the shape of circle.service.ts's real, un-mocked
// activateCircle guard, which this ticket's own instruction (9D.1 §18/§19)
// requires verifying without claiming live persistence -- the configured
// DATABASE_URL is Neon, stated unreachable for this ticket -- so no new
// live-database fixture test is added here, matching the same
// already-established regex-based-structural-check methodology this
// codebase uses whenever a real environment (a browser, a reachable
// database) isn't available (see phase-7j-contribution-workflow-freeze.md
// §11's own explicit statement of this methodology for the UI layer).

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const circleService = readFileSync(new URL("./circle.service.ts", import.meta.url), "utf8");
const circleServiceCode = stripComments(circleService);
const circleRepository = readFileSync(new URL("../repositories/circle.repository.ts", import.meta.url), "utf8");
const circleSchema = readFileSync(new URL("../validations/circle.schema.ts", import.meta.url), "utf8");
const errorPresentation = readFileSync(new URL("../i18n/susu-draft-error-presentation.ts", import.meta.url), "utf8");

test("activateCircle rejects an IMPORTED circle before branching on DRAFT/ACTIVE status, using the exported, exact-string guard message", () => {
  const bodyStart = circleServiceCode.indexOf("export async function activateCircle");
  assert.ok(bodyStart >= 0, "expected to find activateCircle");
  const body = circleServiceCode.slice(bodyStart); // last export in the file
  const ownershipCheckIndex = body.indexOf("circle.ownerId !== input.ownerId");
  const importedGuardIndex = body.indexOf('circle.originKind === "IMPORTED"');
  const statusBranchIndex = body.indexOf('circle.status === "ACTIVE"');
  assert.ok(ownershipCheckIndex >= 0, "expected an ownership check");
  assert.ok(importedGuardIndex >= 0, "expected the IMPORTED guard");
  assert.ok(statusBranchIndex >= 0, "expected the DRAFT/ACTIVE status branch");
  assert.ok(
    ownershipCheckIndex < importedGuardIndex && importedGuardIndex < statusBranchIndex,
    "the IMPORTED guard must run after ownership is verified but before any DRAFT/ACTIVE branching -- it must apply uniformly, never be reachable only from one branch",
  );
  assert.match(body, /throw new CircleActivationEligibilityError\(IMPORTED_ACTIVATION_NOT_READY_MESSAGE\)/);
  assert.match(circleService, /export const IMPORTED_ACTIVATION_NOT_READY_MESSAGE =/);
});

test("the IMPORTED activation guard writes no round, obligation, or payout row -- it only reads and throws", () => {
  const bodyStart = circleServiceCode.indexOf("export async function activateCircle");
  const guardStart = circleServiceCode.indexOf('circle.originKind === "IMPORTED"', bodyStart);
  const guardEnd = circleServiceCode.indexOf("\n    }", guardStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart, "expected to find the guard block");
  assert.doesNotMatch(circleServiceCode.slice(guardStart, guardEnd), /\.(create|createMany|update|updateMany)\(/);
});

test("the IMPORTED activation guard's presented message is reachable and localizable at the owner UI boundary", () => {
  assert.match(errorPresentation, /IMPORTED_ACTIVATION_NOT_READY_MESSAGE|Importing a SUSU already in progress isn't ready for activation yet\. This setup step is coming soon\./);
  assert.match(errorPresentation, /copy\.errorImportedActivationNotReady/);
});

test("origin is never an accepted client input for import declaration -- importedAt/importedById appear nowhere in the validated schemas or the action-facing create/update input contracts", () => {
  assert.doesNotMatch(circleSchema, /importedAt|importedById/);
  for (const schemaName of [
    "createDraftCircleSchema",
    "createImportedDraftCircleSchema",
    "updateDraftCircleConfigurationSchema",
    "updateImportedDraftCircleConfigurationSchema",
  ]) {
    assert.match(circleSchema, new RegExp(`export const ${schemaName}`));
  }
});

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `expected to find "${startMarker}"`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `expected to find "${endMarker}" after "${startMarker}"`);
  return source.slice(start, end);
}

test("createDraftCircleRecord always writes importedAt/importedById as null -- DRAFT creation/editing never sets import activation provenance, for either origin", () => {
  const createRecord = extractBetween(circleRepository, "export function createDraftCircleRecord", "\nexport ");
  assert.match(createRecord, /importedAt:\s*null/);
  assert.match(createRecord, /importedById:\s*null/);
  const updateRecord = extractBetween(circleRepository, "export function updateDraftCircleConfigurationRecord", "\nexport ");
  assert.doesNotMatch(updateRecord, /importedAt|importedById/);
});

test("updateDraftCircleConfigurationRecord never writes originKind -- origin is frozen once created, so no writer (including this one) may change it", () => {
  const updateRecord = extractBetween(circleRepository, "export function updateDraftCircleConfigurationRecord", "\nexport ");
  const dataBlock = updateRecord.match(/data: \{([\s\S]*?)\n\s*\},/)?.[1] ?? "";
  assert.ok(dataBlock.length > 0, "expected to find the data block");
  assert.doesNotMatch(dataBlock, /originKind/);
});

test("updateDraftCircleConfiguration refuses a mismatch between the caller's claimed originKind and the circle's persisted originKind, before any write", () => {
  const start = circleServiceCode.indexOf("export async function updateDraftCircleConfiguration");
  const end = circleServiceCode.indexOf("export async function addDraftCircleMember", start);
  assert.ok(start >= 0 && end > start, "expected to find updateDraftCircleConfiguration's body");
  const fn = circleServiceCode.slice(start, end);
  const mismatchCheckIndex = fn.indexOf("circle.originKind !== input.originKind");
  const writeIndex = fn.indexOf("updateDraftCircleConfigurationRecord(transaction");
  assert.ok(mismatchCheckIndex >= 0, "expected an origin-mismatch check");
  assert.ok(writeIndex >= 0, "expected the actual write call");
  assert.ok(mismatchCheckIndex < writeIndex, "the origin-mismatch check must run before the write");
  assert.match(fn, /throw new DraftCircleConfigurationConflictError/);
});

test("no member-session identity system is referenced anywhere in the import DRAFT configuration path", () => {
  for (const forbidden of ["requireCircleMember", "nia_member_session", "CircleMemberSession"]) {
    assert.ok(!circleServiceCode.includes(forbidden), `expected no reference to "${forbidden}" in circle.service.ts`);
  }
});
