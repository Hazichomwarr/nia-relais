import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./goal-custodian-section.tsx", import.meta.url), "utf8");

test("goal workspace reuses the frozen custodian actions without client actor or lifecycle fields", () => {
  assert.match(source, /createCustodianAssignmentAction/);
  assert.match(source, /cancelCustodianAssignmentRequestAction/);
  assert.match(source, /endCustodianAssignmentAction/);
  assert.match(source, /name="goalId" value=\{goalId\}/);
  assert.match(source, /name="custodianEmail"/);
  for (const forbidden of ["ownerId", 'name="status"', "assignedById", "userId"]) assert.doesNotMatch(source, new RegExp(forbidden));
});
