import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../prisma/migrations/20260915010000_susu_import_provenance_foundation/migration.sql", import.meta.url),
  "utf8",
);
const circleService = readFileSync(new URL("../services/circle.service.ts", import.meta.url), "utf8");
const roundLifecycleService = readFileSync(new URL("../services/round-lifecycle.service.ts", import.meta.url), "utf8");
const contributionPaymentSchema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const memberAuthSchema = readFileSync(new URL("./circle-member-auth.schema.ts", import.meta.url), "utf8");

function enumValues(name: string): string[] {
  const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} must be declared`);
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("9C provenance enums use the frozen categorical vocabulary", () => {
  assert.deepEqual(enumValues("CircleOriginKind"), ["NEW", "IMPORTED"]);
  assert.deepEqual(enumValues("RoundClosureBasis"), ["NIA_MANAGED", "IMPORTED_DECLARATION"]);
  assert.deepEqual(enumValues("ContributionFulfillmentBasis"), ["NIA_CONFIRMED_LEDGER", "IMPORTED_DECLARATION"]);
  assert.deepEqual(enumValues("PayoutConfirmationBasis"), ["MEMBER_CONFIRMED", "IMPORTED_DECLARATION"]);
});

test("circle import state is explicit, default-safe, and backed by only the safe database constraint", () => {
  assert.match(schema, /originKind\s+CircleOriginKind\s+@default\(NEW\)/);
  assert.match(schema, /historicalCompletedRoundCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /importedAt\s+DateTime\?/);
  assert.match(schema, /importedById\s+String\?/);
  assert.match(schema, /@relation\("CircleImporter", fields: \[importedById\], references: \[id\], onDelete: Restrict\)/);
  assert.match(schema, /importedCircles\s+SavingsCircle\[\]\s+@relation\("CircleImporter"\)/);
  assert.match(migration, /CHECK \("historicalCompletedRoundCount" >= 0\)/);
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.doesNotMatch(migration, /CREATE INDEX|CREATE UNIQUE INDEX/);
});

test("round, obligation, and payout basis defaults preserve ordinary NIA-managed behavior", () => {
  assert.match(schema, /closureBasis\s+RoundClosureBasis\s+@default\(NIA_MANAGED\)/);
  assert.match(schema, /fulfillmentBasis\s+ContributionFulfillmentBasis\s+@default\(NIA_CONFIRMED_LEDGER\)/);
  assert.match(schema, /confirmationBasis\s+PayoutConfirmationBasis\s+@default\(MEMBER_CONFIRMED\)/);
  assert.match(migration, /DEFAULT 'NIA_MANAGED'/);
  assert.match(migration, /DEFAULT 'NIA_CONFIRMED_LEDGER'/);
  assert.match(migration, /DEFAULT 'MEMBER_CONFIRMED'/);
});

test("existing financial and membership persistence semantics remain intact", () => {
  assert.deepEqual(enumValues("ContributionPaymentStatus"), ["RECORDED", "CONFIRMED", "REJECTED"]);
  assert.deepEqual(enumValues("PayoutStatus"), ["RECORDED", "CONFIRMED", "DISPUTED"]);
  assert.match(contributionPaymentSchema, /model ContributionPayment \{[\s\S]*?status\s+ContributionPaymentStatus\s+@default\(RECORDED\)[\s\S]*?\n\}/);
  assert.match(schema, /model CircleMember \{[\s\S]*?phone\s+String\?[\s\S]*?pinHash\s+String/);
  assert.doesNotMatch(memberAuthSchema, /phone/);
});

test("9C's own migration adds no data writes", () => {
  assert.doesNotMatch(migration, /^\s*(INSERT INTO|UPDATE|DELETE FROM|DROP)\b/m);
});

// Originally asserted that circle.service.ts, like round-lifecycle.service.ts,
// contained none of these terms at all (true for 9C's persistence-only
// foundation), then that circle.service.ts carried origin/K but none of
// the basis-provenance vocabulary (true through 9D.1, since reconstruction
// was still unimplemented). 9E (docs/product/susu-existing-import-contract-freeze.md
// §5, "Import activation and rotation reconstruction") legitimately
// introduced closureBasis/fulfillmentBasis/confirmationBasis/
// IMPORTED_DECLARATION to circle.service.ts -- activateImportedCircle's
// own historical reconstruction. 9F (§6, "first live round lifecycle")
// then legitimately extended round-lifecycle.service.ts's own
// activateFirstRound with the SAME vocabulary, to verify the historical
// prefix before deriving/activating K+1 -- see
// round-lifecycle-first-live-round.test.ts and
// round-lifecycle-9f-preservation.test.ts for 9F's own direct evidence.
// What must remain true, unchanged, through every ticket including 9F:
// round-lifecycle.service.ts's OWN advanceRound (subsequent K+2+
// progression) still knows nothing about import at all.
test("circle.service.ts and round-lifecycle.service.ts's activateFirstRound now legitimately carry the full basis-provenance vocabulary; advanceRound remains untouched", () => {
  const advanceRoundBody = roundLifecycleService.slice(roundLifecycleService.indexOf("export async function advanceRound"));
  assert.doesNotMatch(advanceRoundBody, /IMPORTED_DECLARATION|historicalCompletedRoundCount|originKind|closureBasis|fulfillmentBasis|confirmationBasis/);
  assert.match(circleService, /originKind/);
  assert.match(circleService, /historicalCompletedRoundCount/);
  assert.match(circleService, /IMPORTED_DECLARATION/);
  assert.match(circleService, /closureBasis/);
  assert.match(circleService, /fulfillmentBasis/);
  assert.match(circleService, /confirmationBasis/);
});
