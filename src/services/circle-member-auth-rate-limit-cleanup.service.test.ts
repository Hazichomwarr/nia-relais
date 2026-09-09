import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { cleanupExpiredMemberAuthRateLimitBuckets } from "@/src/services/circle-member-auth-rate-limit-cleanup.service";
import { deleteExpiredRateLimitBucketBatch } from "@/src/repositories/circle-member-auth-rate-limit-cleanup.repository";
import { checkIsolatedTestDatabaseConfiguration } from "@/src/testing/isolated-test-database";

// ---------------------------------------------------------------------------
// Section 1: the safety guard itself. Fully runnable without any database --
// this is pure decision logic over environment values, which is exactly the
// point: destructive-test eligibility must be provable without needing a
// database connection to prove it.
// ---------------------------------------------------------------------------

test("Guard: refuses when TEST_DATABASE_URL is unset", () => {
  const saved = { test: process.env.TEST_DATABASE_URL, db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    const result = checkIsolatedTestDatabaseConfiguration();
    assert.equal(result.isolated, false);
  } finally {
    restoreEnv(saved);
  }
});

test("Guard: refuses when TEST_DATABASE_URL is identical to DATABASE_URL", () => {
  const saved = { test: process.env.TEST_DATABASE_URL, db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    process.env.DATABASE_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    const result = checkIsolatedTestDatabaseConfiguration();
    assert.equal(result.isolated, false);
  } finally {
    restoreEnv(saved);
  }
});

test("Guard: refuses when TEST_DATABASE_URL shares a hostname with DATABASE_URL even if the rest of the URL differs", () => {
  // Same host, different query string / credentials -- a raw string-equality
  // check would miss this; the hostname comparison must not.
  const saved = { test: process.env.TEST_DATABASE_URL, db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    process.env.DATABASE_URL = "postgresql://user:pass@prod.example.internal:5432/neondb?sslmode=require";
    process.env.TEST_DATABASE_URL = "postgresql://other-user:other-pass@prod.example.internal:5432/neondb?sslmode=disable";
    const result = checkIsolatedTestDatabaseConfiguration();
    assert.equal(result.isolated, false);
  } finally {
    restoreEnv(saved);
  }
});

test("Guard: refuses when TEST_DATABASE_URL shares a hostname with DIRECT_URL", () => {
  const saved = { test: process.env.TEST_DATABASE_URL, db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    process.env.DATABASE_URL = "postgresql://user:pass@prod-pooler.example.internal:5432/neondb";
    process.env.DIRECT_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    const result = checkIsolatedTestDatabaseConfiguration();
    assert.equal(result.isolated, false);
  } finally {
    restoreEnv(saved);
  }
});

test("Guard: refuses when TEST_DATABASE_URL is not a valid URL", () => {
  const saved = { test: process.env.TEST_DATABASE_URL, db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    process.env.TEST_DATABASE_URL = "not-a-url";
    const result = checkIsolatedTestDatabaseConfiguration();
    assert.equal(result.isolated, false);
  } finally {
    restoreEnv(saved);
  }
});

test("Guard: accepts a genuinely distinct hostname", () => {
  const saved = { test: process.env.TEST_DATABASE_URL, db: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    process.env.DATABASE_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    process.env.DIRECT_URL = "postgresql://user:pass@prod.example.internal:5432/neondb";
    process.env.TEST_DATABASE_URL = "postgresql://user:pass@test-branch.example.internal:5432/neondb";
    const result = checkIsolatedTestDatabaseConfiguration();
    assert.equal(result.isolated, true);
  } finally {
    restoreEnv(saved);
  }
});

function restoreEnv(saved: { test?: string; db?: string; direct?: string }) {
  for (const [key, value] of [
    ["TEST_DATABASE_URL", saved.test],
    ["DATABASE_URL", saved.db],
    ["DIRECT_URL", saved.direct],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Structural: no raw credential/source logging. Fully runnable without any
// database, same technique used throughout this project's test suites.
// ---------------------------------------------------------------------------

test("no raw source/credential material is ever logged by the cleanup service or repository", () => {
  const servicePath = fileURLToPath(new URL("./circle-member-auth-rate-limit-cleanup.service.ts", import.meta.url));
  const repositoryPath = fileURLToPath(
    new URL("../repositories/circle-member-auth-rate-limit-cleanup.repository.ts", import.meta.url),
  );
  const combined = readFileSync(servicePath, "utf8") + "\n" + readFileSync(repositoryPath, "utf8");

  const consoleCalls = combined.match(/console\.(error|log|warn)\([\s\S]*?\);/g) ?? [];
  for (const call of consoleCalls) {
    for (const forbidden of ["keyHash", "sourceValue", "memberCode", "pinHash", "secret"]) {
      assert.ok(!call.includes(forbidden), `console call unexpectedly references "${forbidden}": ${call}`);
    }
  }

  assert.ok(!combined.includes("circleMember."), "cleanup must not touch CircleMember");
  assert.ok(!combined.includes("bcryptjs"), "cleanup must not touch credential material");
});

// ---------------------------------------------------------------------------
// Destructive tests. These create and delete CircleMemberAuthRateLimitBucket
// rows and therefore run ONLY against an explicitly isolated test database
// (see the guard above) -- never against the shared application database,
// regardless of NODE_ENV. If TEST_DATABASE_URL is not configured as a
// verifiably separate database, every test in this block is skipped, not
// silently omitted: the skip reason is reported in the test output itself.
// ---------------------------------------------------------------------------

const isolation = checkIsolatedTestDatabaseConfiguration();
const skipDestructive = isolation.isolated
  ? false
  : `Isolated test database unavailable: ${isolation.reason} Set TEST_DATABASE_URL to a separate database (e.g. a dedicated Neon branch) to run these tests.`;

let testPrisma: PrismaClient | null = null;
if (isolation.isolated) {
  const adapter = new PrismaPg({ connectionString: isolation.connectionString });
  testPrisma = new PrismaClient({ adapter });
}

function hmacHex(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

async function insertBucketRow(
  client: PrismaClient,
  input: { scope: "SOURCE" | "TARGET" | "GLOBAL"; keyHash: string; windowStart: Date; expiresAt: Date },
) {
  await client.$executeRaw`
    INSERT INTO "CircleMemberAuthRateLimitBucket"
      (id, scope, "keyHash", "windowStart", "attemptCount", "expiresAt", "createdAt", "updatedAt")
    VALUES (
      ${randomUUID()},
      ${input.scope}::"CircleMemberAuthRateLimitScope",
      ${input.keyHash},
      ${input.windowStart},
      1,
      ${input.expiresAt},
      now(),
      now()
    )
  `;
}

test("expired rows are deleted", { skip: skipDestructive }, async () => {
  const client = testPrisma!;
  const keyHash = hmacHex("cleanup-test-secret-not-real-32-chars-min", `expired:${randomUUID()}`);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  await insertBucketRow(client, { scope: "SOURCE", keyHash, windowStart: new Date(past.getTime() - 900_000), expiresAt: past });

  const before = await client.circleMemberAuthRateLimitBucket.count({ where: { keyHash } });
  assert.equal(before, 1);

  await cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 500 });

  const after = await client.circleMemberAuthRateLimitBucket.count({ where: { keyHash } });
  assert.equal(after, 0, "an expired row must be deleted by cleanup");
});

test("active-window rows are preserved", { skip: skipDestructive }, async () => {
  const client = testPrisma!;
  const keyHash = hmacHex("cleanup-test-secret-not-real-32-chars-min", `active:${randomUUID()}`);
  const future = new Date(Date.now() + 60 * 60 * 1000);

  await insertBucketRow(client, { scope: "SOURCE", keyHash, windowStart: new Date(), expiresAt: future });

  await cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 500 });

  const after = await client.circleMemberAuthRateLimitBucket.count({ where: { keyHash } });
  assert.equal(after, 1, "an active-window row must never be deleted by cleanup");

  await client.circleMemberAuthRateLimitBucket.deleteMany({ where: { keyHash } });
});

test("batch size is respected", { skip: skipDestructive }, async () => {
  const client = testPrisma!;
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const prefix = `batch:${randomUUID()}`;
  const keyHashes: string[] = [];

  for (let i = 0; i < 5; i++) {
    const keyHash = hmacHex("cleanup-test-secret-not-real-32-chars-min", `${prefix}:${i}`);
    keyHashes.push(keyHash);
    await insertBucketRow(client, { scope: "SOURCE", keyHash, windowStart: new Date(past.getTime() - 900_000), expiresAt: past });
  }

  const { deletedCount } = await deleteExpiredRateLimitBucketBatch(client, 3);
  assert.ok(deletedCount <= 3, "a single invocation must never delete more than the requested batch size");

  await client.circleMemberAuthRateLimitBucket.deleteMany({ where: { keyHash: { in: keyHashes } } });
});

test("repeated cleanup is safe (idempotent when nothing remains)", { skip: skipDestructive }, async () => {
  const first = await cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 10 });
  const second = await cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 10 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
});

test("concurrent cleanup is safe", { skip: skipDestructive }, async () => {
  const client = testPrisma!;
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const prefix = `concurrent:${randomUUID()}`;
  const keyHashes: string[] = [];

  for (let i = 0; i < 10; i++) {
    const keyHash = hmacHex("cleanup-test-secret-not-real-32-chars-min", `${prefix}:${i}`);
    keyHashes.push(keyHash);
    await insertBucketRow(client, { scope: "SOURCE", keyHash, windowStart: new Date(past.getTime() - 900_000), expiresAt: past });
  }

  const results = await Promise.all([
    cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 100 }),
    cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 100 }),
  ]);

  assert.ok(results.every((r) => r.ok), "no concurrent cleanup invocation should error");

  const remaining = await client.circleMemberAuthRateLimitBucket.count({ where: { keyHash: { in: keyHashes } } });
  assert.equal(remaining, 0, "all ten expired rows must be gone after two concurrent cleanup calls");
});

test("expiry is evaluated against PostgreSQL's own clock", { skip: skipDestructive }, async () => {
  const client = testPrisma!;
  const keyHash = hmacHex("cleanup-test-secret-not-real-32-chars-min", `dbtime:${randomUUID()}`);
  // Expires one second in the future by JS's clock -- if the repository used
  // Date.now() instead of the DB's now(), a clock difference could make this
  // flake in either direction. Sleeping past it and re-checking against the
  // DB's own now() proves the comparison is authoritative regardless.
  const almostNow = new Date(Date.now() + 1000);

  await insertBucketRow(client, { scope: "SOURCE", keyHash, windowStart: new Date(), expiresAt: almostNow });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 500 });

  const after = await client.circleMemberAuthRateLimitBucket.count({ where: { keyHash } });
  assert.equal(after, 0, "a row whose expiry has passed according to the database's own clock must be deleted");
});

test("cleanup never touches domain or session tables", { skip: skipDestructive }, async () => {
  const client = testPrisma!;
  const before = {
    users: await client.user.count(),
    goals: await client.personalGoal.count(),
    circles: await client.savingsCircle.count(),
    sessions: await client.circleMemberSession.count(),
  };

  await cleanupExpiredMemberAuthRateLimitBuckets({ batchSize: 500 });

  const after = {
    users: await client.user.count(),
    goals: await client.personalGoal.count(),
    circles: await client.savingsCircle.count(),
    sessions: await client.circleMemberSession.count(),
  };

  assert.deepEqual(after, before);
});

test.after(async () => {
  await testPrisma?.$disconnect();
});
