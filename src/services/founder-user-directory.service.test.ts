import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
import { categoryWhere, founderDirectoryWhere } from "@/src/repositories/founder-user-directory.repository";
import {
  categoryForCounts,
  getFounderUserDirectory,
  parseFounderDirectoryQuery,
} from "./founder-user-directory.service";

const founder = { id: "caaaaaaaaaaaaaaaaaaaaaaaa", name: "Founder" };
const createdAt = new Date("2026-10-31T12:00:00.000Z");

function record(id: string, goals: number, circles: number, created = createdAt) {
  return { id, name: "Person", email: "person@example.com", createdAt: created, _count: { ownedGoals: goals, ownedCircles: circles } };
}

function repository(records = [record("c1", 1, 0)]) {
  const calls: unknown[] = [];
  return {
    calls,
    count: async (query: unknown) => { calls.push(["count", query]); return records.length; },
    findPage: async (query: unknown) => { calls.push(["findPage", query]); return records; },
  };
}

test("founder may retrieve a minimum-field directory page with mutually exclusive product categories", async () => {
  const data = repository([record("c1", 2, 0), record("c2", 0, 3), record("c3", 1, 1), record("c4", 0, 0)]);
  const result = await getFounderUserDirectory({}, { requireSuperAdmin: async () => founder, repository: data });

  assert.deepEqual(result.entries.map(({ id, category, goalCount, circleCount }) => ({ id, category, goalCount, circleCount })), [
    { id: "c1", category: "PERSONAL_SAVINGS", goalCount: 2, circleCount: 0 },
    { id: "c2", category: "SUSU", goalCount: 0, circleCount: 3 },
    { id: "c3", category: "BOTH", goalCount: 1, circleCount: 1 },
    { id: "c4", category: "NEITHER", goalCount: 0, circleCount: 0 },
  ]);
  assert.equal("passwordHash" in result.entries[0]!, false);
  assert.equal("deposits" in result.entries[0]!, false);
});

test("directory loader independently authorizes before any count or list query", async () => {
  const data = repository();
  await assert.rejects(() => getFounderUserDirectory({}, {
    requireSuperAdmin: async () => { throw new Error("denied"); },
    repository: data,
  }));
  assert.deepEqual(data.calls, []);
});

test("case-preserving server query parsing safely normalizes filters and invalid pagination", () => {
  assert.deepEqual(parseFounderDirectoryQuery({ search: "  Ada@Example.com  ", category: "BOTH", page: "2" }), {
    search: "Ada@Example.com", category: "BOTH", page: 2,
  });
  assert.deepEqual(parseFounderDirectoryQuery({ search: "x".repeat(101), category: "unknown", page: "-1" }), {
    search: "", category: "ALL", page: 1,
  });
});

test("all five directory filters use the approved ownership semantics, including users who own both products", () => {
  assert.deepEqual(categoryWhere("ALL"), {});
  assert.deepEqual(categoryWhere("PERSONAL_SAVINGS"), { ownedGoals: { some: {} } });
  assert.deepEqual(categoryWhere("SUSU"), { ownedCircles: { some: {} } });
  assert.deepEqual(categoryWhere("BOTH"), { ownedGoals: { some: {} }, ownedCircles: { some: {} } });
  assert.deepEqual(categoryWhere("NEITHER"), { ownedGoals: { none: {} }, ownedCircles: { none: {} } });
});

test("inclusive product filters retain their ownership predicate when combined with a search", () => {
  assert.deepEqual(founderDirectoryWhere({ search: "Ada", category: "PERSONAL_SAVINGS" }), {
    AND: [
      { ownedGoals: { some: {} } },
      { OR: [{ name: { contains: "Ada", mode: "insensitive" } }, { email: { contains: "Ada", mode: "insensitive" } }] },
    ],
  });
  assert.deepEqual(founderDirectoryWhere({ search: "Ada", category: "SUSU" }), {
    AND: [
      { ownedCircles: { some: {} } },
      { OR: [{ name: { contains: "Ada", mode: "insensitive" } }, { email: { contains: "Ada", mode: "insensitive" } }] },
    ],
  });
});

test("pagination is capped to the final available page and preserves a complete filtered count", async () => {
  const data = repository([record("c1", 1, 1)]);
  data.count = async (query: unknown) => { data.calls.push(["count", query]); return 21; };
  const result = await getFounderUserDirectory({ page: "99", search: "ada", category: "BOTH" }, { requireSuperAdmin: async () => founder, repository: data });
  assert.equal(result.totalMatchingUsers, 21);
  assert.equal(result.pageCount, 2);
  assert.equal(result.page, 2);
  assert.deepEqual(data.calls.at(-1), ["findPage", { search: "ada", category: "BOTH", page: 2 }]);
});

test("category classification treats archived owned records consistently as owned", () => {
  assert.equal(categoryForCounts(1, 0), "PERSONAL_SAVINGS");
  assert.equal(categoryForCounts(0, 1), "SUSU");
});

const repositorySource = readFileSync(new URL("../repositories/founder-user-directory.repository.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/(app)/admin/users/page.tsx", import.meta.url), "utf8");

test("overlapping-product entries receive the correct secondary ownership label in EN and FR", () => {
  assert.equal(en.adminDirectory.alsoOwnsSusuCircles, "Also owns SUSU circles");
  assert.equal(en.adminDirectory.alsoOwnsPersonalSavings, "Also owns Personal Savings");
  assert.equal(fr.adminDirectory.alsoOwnsSusuCircles, "Possède aussi des cercles SUSU");
  assert.equal(fr.adminDirectory.alsoOwnsPersonalSavings, "Possède aussi une épargne personnelle");
  assert.match(pageSource, /selectedCategory === "PERSONAL_SAVINGS"/);
  assert.match(pageSource, /selectedCategory === "SUSU"/);
  assert.match(pageSource, /copy\.alsoOwnsSusuCircles/);
  assert.match(pageSource, /copy\.alsoOwnsPersonalSavings/);
});

test("repository filters before deterministic pagination and selects no credentials or financial histories", () => {
  assert.match(repositorySource, /mode: "insensitive"/);
  assert.match(repositorySource, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(repositorySource, /take: FOUNDER_DIRECTORY_PAGE_SIZE/);
  for (const forbidden of ["passwordHash", "pinHash", "Deposit", "ContributionPayment", "Payout"]) {
    assert.doesNotMatch(repositorySource, new RegExp(forbidden));
  }
  assert.match(pageSource, /robots: \{ index: false, follow: false \}/);
  assert.match(pageSource, /await requireSuperAdmin\(\)/);
});
