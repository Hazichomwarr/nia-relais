import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 9H (P0 fix, docs/product/susu-existing-import-contract-freeze.md §7):
// structural/source evidence for the completion-service fix, since the
// live database that would exercise circle-completion.service.test.ts's
// own end-to-end lifecycle tests is unreachable in this environment (the
// 9C/9A migrations are unapplied on the reachable Neon database -- see the
// 9H closeout report's "LIVE DATABASE" section). Mirrors the established
// pattern from 9E/9F (e.g. circle-imported-activation-structure.test.ts):
// prove the wiring exists and is coherent by reading the actual source,
// while src/domain/round-lifecycle.test.ts's own new
// assertImportedRoundClosureCoherence tests prove the underlying predicate
// is correct as a pure function, with no database at all.
//
// The defect this fix addresses: circle-completion.service.ts previously
// ran EVERY round (imported and NIA-managed alike) through
// assessPayoutClosureReadiness, which requires
// `payout.confirmedByMemberId === recipientId` for a CONFIRMED payout to
// be READY. An imported payout's confirmedByMemberId is always null (by
// design, freeze §4) -- so completeCircle could never succeed for ANY
// circle with an imported prefix (K >= 1), even after its entire live
// suffix legitimately closed. This is exactly the scenario ticket 9H §15
// names ("K = N - 1 ... close N ... explicit owner completion").

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const serviceSource = stripComments(
  readFileSync(new URL("./circle-completion.service.ts", import.meta.url), "utf8"),
);
const repositorySource = stripComments(
  readFileSync(new URL("../repositories/circle-completion.repository.ts", import.meta.url), "utf8"),
);

test("circle-completion.repository.ts selects fulfillmentBasis and confirmationBasis, needed to distinguish imported from NIA-managed rounds", () => {
  assert.match(repositorySource, /fulfillmentBasis:\s*true/);
  assert.match(repositorySource, /confirmationBasis:\s*true/);
});

test("circle-completion.service.ts imports assertImportedRoundClosureCoherence from the shared domain module -- never a second, independently-drifting predicate", () => {
  assert.match(serviceSource, /assertImportedRoundClosureCoherence/);
  assert.match(serviceSource, /from ["']@\/src\/domain\/round-lifecycle["']/);
});

test("assertRoundFinanciallyReadyForCompletion branches on round.closureBasis before choosing a readiness predicate", () => {
  const fnMatch = serviceSource.match(
    /function assertRoundFinanciallyReadyForCompletion\([\s\S]*?\n}\n/,
  );
  assert.ok(fnMatch, "expected to find assertRoundFinanciallyReadyForCompletion's body");
  const body = fnMatch![0];

  assert.match(body, /round\.closureBasis === "IMPORTED_DECLARATION"/);
  assert.match(body, /assertImportedRoundClosureCoherence\(/);
  // The NIA-managed path (assessContributionClosureReadiness/
  // assessPayoutClosureReadiness) must still be reachable in the same
  // function, for every round that is NOT imported -- this fix must not
  // have replaced or bypassed the existing, already-frozen normal path.
  assert.match(body, /assessContributionClosureReadiness\(/);
  assert.match(body, /assessPayoutClosureReadiness\(/);
});

test("the imported branch returns before reaching the NIA-managed predicates -- an imported round is never also run through assessPayoutClosureReadiness", () => {
  const fnMatch = serviceSource.match(
    /function assertRoundFinanciallyReadyForCompletion\([\s\S]*?\n}\n/,
  );
  const body = fnMatch![0];
  const importedBranchIndex = body.indexOf('round.closureBasis === "IMPORTED_DECLARATION"');
  const returnIndex = body.indexOf("return;", importedBranchIndex);
  const nextPredicateIndex = body.indexOf("assessContributionClosureReadiness(");
  assert.ok(importedBranchIndex >= 0 && returnIndex > importedBranchIndex && returnIndex < nextPredicateIndex);
});

test("no fabricated ContributionPayment/member confirmation is introduced -- this file still writes only SavingsCircle.status/completedAt/completedById", () => {
  assert.doesNotMatch(serviceSource, /contributionPayment\.(create|update)/i);
  assert.doesNotMatch(serviceSource, /payout\.(create|update)/i);
  assert.match(serviceSource, /completeActiveCircle/);
});
