import assert from "node:assert/strict";
import test from "node:test";

import { formatOwnerDate, getMemberStatusBadgeLabel, getRoundStatusBadge } from "./circle-workspace-display";

test("getMemberStatusBadgeLabel maps CircleMemberStatus to a human label", () => {
  assert.equal(getMemberStatusBadgeLabel("ACTIVE"), "Active");
  assert.equal(getMemberStatusBadgeLabel("REMOVED"), "Removed");
});

test("formatOwnerDate renders a readable date from an ISO timestamp", () => {
  assert.match(formatOwnerDate("2026-02-15T00:00:00.000Z"), /2026/);
});

test("getRoundStatusBadge labels each persisted round status, never implying UPCOMING is currently collecting", () => {
  assert.equal(getRoundStatusBadge("ACTIVE").label, "Active");
  assert.equal(getRoundStatusBadge("CLOSED").label, "Closed");
  const upcoming = getRoundStatusBadge("UPCOMING");
  assert.equal(upcoming.label, "Upcoming");
  assert.doesNotMatch(upcoming.label.toLowerCase(), /active|collecting/);
});

test("getRoundStatusBadge falls back gracefully for an unrecognized status rather than throwing", () => {
  const result = getRoundStatusBadge("SOMETHING_UNKNOWN");
  assert.equal(result.label, "SOMETHING_UNKNOWN");
  assert.ok(result.className.length > 0);
});
