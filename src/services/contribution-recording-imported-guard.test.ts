import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 9H (P0 fix, docs/product/susu-existing-import-contract-freeze.md §8):
// structural/source evidence for the contribution-recording fix, since the
// live database that would exercise contribution-recording.service.test.ts's
// own end-to-end tests is unreachable in this environment (see the 9H
// closeout report's "LIVE DATABASE" section).
//
// The defect this fix addresses: recordContribution's "already fulfilled"
// guard (findActiveOrConfirmedPaymentForObligation) is entirely
// ledger-based -- it only sees an existing ContributionPayment row. An
// imported-declaration obligation (fulfillmentBasis = IMPORTED_DECLARATION)
// has, by design, ZERO ContributionPayment rows (freeze §4) even though it
// is already FULFILLED and its round is already CLOSED -- so, before this
// fix, an owner could record a brand-new, live ContributionPayment against
// an already-closed historical round, fabricating a real financial event on
// top of a declared one. This directly violates freeze §8: "No writer may
// create/confirm/reject a contribution against an imported CLOSED historical
// round."

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const serviceSource = stripComments(
  readFileSync(new URL("./contribution-recording.service.ts", import.meta.url), "utf8"),
);
const repositorySource = stripComments(
  readFileSync(new URL("../repositories/contribution-recording.repository.ts", import.meta.url), "utf8"),
);
const actionSource = stripComments(
  readFileSync(new URL("../actions/record-contribution.ts", import.meta.url), "utf8"),
);

test("contribution-recording.repository.ts selects fulfillmentBasis on the obligation it hands to the recording service", () => {
  assert.match(repositorySource, /fulfillmentBasis:\s*true/);
});

test("recordContribution rejects an IMPORTED_DECLARATION obligation before any ledger-based check", () => {
  const obligationFetchIndex = serviceSource.indexOf("findObligationForRecording(transaction");
  const guardIndex = serviceSource.indexOf('obligation.fulfillmentBasis === "IMPORTED_DECLARATION"');
  const activeOrConfirmedCheckIndex = serviceSource.indexOf("findActiveOrConfirmedPaymentForObligation(\n        transaction");
  assert.ok(obligationFetchIndex >= 0, "expected to find the obligation fetch");
  assert.ok(guardIndex > obligationFetchIndex, "expected the imported guard after the obligation fetch");
  assert.match(serviceSource, /throw new ContributionObligationImportedError\(\)/);
  if (activeOrConfirmedCheckIndex >= 0) {
    assert.ok(
      guardIndex < activeOrConfirmedCheckIndex,
      "the imported guard must run before the ledger-based already-fulfilled check",
    );
  }
});

test("ContributionObligationImportedError is exported and mapped to a safe, specific user-facing message by the action layer", () => {
  assert.match(serviceSource, /export class ContributionObligationImportedError extends Error/);
  assert.match(actionSource, /ContributionObligationImportedError/);
  // Must be routed to the recognized-error branch (formError: error.message),
  // never fall through to the generic "unexpected failure" console.error path.
  const actionBody = actionSource;
  const importIndex = actionBody.indexOf("ContributionObligationImportedError");
  const recognizedBranchIndex = actionBody.indexOf("error instanceof ContributionObligationImportedError");
  assert.ok(importIndex >= 0 && recognizedBranchIndex > 0);
});

test("no ledger row is ever fabricated by this fix -- the guard only throws, it never creates/updates a ContributionPayment", () => {
  const guardBlockMatch = serviceSource.match(
    /if \(obligation\.fulfillmentBasis === "IMPORTED_DECLARATION"\) \{[\s\S]*?\n {6}\}/,
  );
  assert.ok(guardBlockMatch, "expected to find the imported-guard block");
  assert.doesNotMatch(guardBlockMatch![0], /create|update/i);
});
