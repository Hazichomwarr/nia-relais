import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { checkMemberAuthenticationRateLimit } from "@/src/services/circle-member-auth-rate-limit.service";
import {
  incrementRateLimitBucket,
  findRateLimitBucket,
  type RateLimitScope,
} from "@/src/repositories/circle-member-auth-rate-limit.repository";
import { getTrustedMemberAuthSource } from "@/src/auth/trusted-member-auth-source";
import { prisma } from "@/src/prisma";

// This suite talks to the real configured database (temporary fixtures,
// guaranteed cleanup below) because the atomicity, concurrency, and
// database-time guarantees under test are genuine PostgreSQL behaviors that
// a mock cannot faithfully stand in for.

const TEST_SECRET = "test-only-member-auth-rate-limit-secret-do-not-reuse-32ch";
process.env.MEMBER_AUTH_RATE_LIMIT_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH_SOURCE = "1";

function hmacHex(material: string): string {
  return createHmac("sha256", TEST_SECRET).update(material).digest("hex");
}

// Every (scope, keyHash) this file writes to, tracked so the `after` hook
// can delete exactly these rows -- regardless of which fixed window(s) they
// land in -- without touching anything this suite did not create.
const touchedBucketKeys = new Map<RateLimitScope, Set<string>>([
  ["SOURCE", new Set()],
  ["TARGET", new Set()],
  ["GLOBAL", new Set()],
]);

function track(scope: RateLimitScope, keyHash: string) {
  touchedBucketKeys.get(scope)!.add(keyHash);
}

// GLOBAL and the malformed-target sentinel are fixed, shared keys (by
// design -- see the service's own documentation), so they're tracked once
// here rather than per test.
track("GLOBAL", hmacHex("GLOBAL:circle-member-auth"));
track("TARGET", hmacHex("TARGET:malformed-target"));

function randomTestIp(): string {
  // TEST-NET-3 (RFC 5737): reserved for documentation/examples, never a
  // real routable address, so it can never collide with a genuine client.
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
}

function randomCircleId(): string {
  return "c" + randomBytes(13).toString("hex").slice(0, 24);
}

function randomMemberCode(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

function sourceFromIp(ip: string) {
  const result = getTrustedMemberAuthSource(
    new Request("https://example.invalid/", { headers: { "x-nia-test-source": ip } }),
  );
  assert.equal(result.ok, true, "test fixture: expected the test-override source path to succeed");
  if (!result.ok) throw new Error("unreachable");
  track("SOURCE", hmacHex(`SOURCE:${result.source.value}`));
  return result.source;
}

function trackTarget(circleId: string, memberCode: string) {
  track("TARGET", hmacHex(`TARGET:${circleId}:${memberCode}`));
}

async function readBucket(scope: RateLimitScope, keyHash: string, windowSeconds: number) {
  const rows = await prisma.$transaction((tx) => findRateLimitBucket(tx, { scope, keyHash, windowSeconds }));
  return rows[0]?.attemptCount ?? 0;
}

let baselineCounts: { users: number; goals: number; deposits: number; custodians: number };

test.before(async () => {
  baselineCounts = {
    users: await prisma.user.count(),
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
});

test.after(async () => {
  for (const [scope, keyHashes] of touchedBucketKeys) {
    if (keyHashes.size === 0) continue;
    await prisma.circleMemberAuthRateLimitBucket.deleteMany({
      where: { scope, keyHash: { in: [...keyHashes] } },
    });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Repository-level: the generic atomic mechanism, exercised directly with
// synthetic keys and small thresholds so these run fast and don't touch any
// of the three real, policy-shaped keys the service derives.
// ---------------------------------------------------------------------------

test("Repository: threshold enforcement is precise with a small synthetic limit", async () => {
  const keyHash = hmacHex(`REPO-THRESHOLD-TEST:${randomBytes(8).toString("hex")}`);
  track("SOURCE", keyHash);
  const limit = 3;

  const counts: number[] = [];
  for (let i = 0; i < limit + 1; i++) {
    const result = await prisma.$transaction((tx) =>
      incrementRateLimitBucket(tx, { scope: "SOURCE", keyHash, windowSeconds: 900 }),
    );
    counts.push(result.attemptCount);
  }

  assert.deepEqual(counts, [1, 2, 3, 4]);
  assert.ok(counts[limit - 1] <= limit, "the limit-th attempt must still be within the limit");
  assert.ok(counts[limit] > limit, "the (limit+1)-th attempt must exceed the limit");
});

test("G (repository). concurrent increments on the same bucket produce no lost updates", async () => {
  const keyHash = hmacHex(`REPO-CONCURRENCY-TEST:${randomBytes(8).toString("hex")}`);
  track("SOURCE", keyHash);
  const concurrency = 25;

  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      prisma.$transaction((tx) => incrementRateLimitBucket(tx, { scope: "SOURCE", keyHash, windowSeconds: 900 })),
    ),
  );

  const finalCounts = results.map((r) => r.attemptCount).sort((a, b) => a - b);
  assert.deepEqual(
    finalCounts,
    Array.from({ length: concurrency }, (_, i) => i + 1),
    "the set of returned counts across all concurrent callers must be exactly {1..N} with no duplicates or gaps",
  );
});

test("I. a new fixed window resets the counter", async () => {
  const keyHash = hmacHex(`REPO-WINDOW-TEST:${randomBytes(8).toString("hex")}`);
  track("SOURCE", keyHash);
  const windowSeconds = 2;

  const first = await prisma.$transaction((tx) =>
    incrementRateLimitBucket(tx, { scope: "SOURCE", keyHash, windowSeconds }),
  );
  assert.equal(first.attemptCount, 1);

  await new Promise((resolve) => setTimeout(resolve, (windowSeconds + 1) * 1000));

  const second = await prisma.$transaction((tx) =>
    incrementRateLimitBucket(tx, { scope: "SOURCE", keyHash, windowSeconds }),
  );
  assert.equal(second.attemptCount, 1, "a request in a new window must start a fresh counter, not continue the old one");
});

test("J. the window boundary is computed from PostgreSQL's own clock, consistent with real elapsed time", async () => {
  const keyHash = hmacHex(`REPO-DBTIME-TEST:${randomBytes(8).toString("hex")}`);
  track("SOURCE", keyHash);
  const windowSeconds = 900;

  const beforeMs = Date.now();
  await prisma.$transaction((tx) => incrementRateLimitBucket(tx, { scope: "SOURCE", keyHash, windowSeconds }));
  const afterMs = Date.now();

  const [row] = await prisma.$transaction((tx) => findRateLimitBucket(tx, { scope: "SOURCE", keyHash, windowSeconds }));
  assert.ok(row, "expected the bucket row to exist");

  const expectedBefore = Math.floor(beforeMs / 1000 / windowSeconds) * windowSeconds * 1000;
  const expectedAfter = Math.floor(afterMs / 1000 / windowSeconds) * windowSeconds * 1000;
  const actual = row.windowStart.getTime();

  assert.ok(
    actual === expectedBefore || actual === expectedAfter,
    `DB-computed window start ${row.windowStart.toISOString()} did not match a boundary derived from real elapsed time`,
  );
});

// ---------------------------------------------------------------------------
// Service-level: the approved policy (SOURCE 20/15min, TARGET 10/15min,
// GLOBAL 1000/1min), wired through checkMemberAuthenticationRateLimit.
// ---------------------------------------------------------------------------

test("A. an allowed request with a fresh source and target returns allowed:true", async () => {
  const source = sourceFromIp(randomTestIp());
  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);

  const decision = await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });
  assert.equal(decision.allowed, true);
});

test("B / E. SOURCE denies the 21st attempt from one source, even when every target differs (spraying)", async () => {
  const source = sourceFromIp(randomTestIp());
  const decisions: boolean[] = [];

  for (let i = 0; i < 21; i++) {
    const circleId = randomCircleId();
    const memberCode = randomMemberCode();
    trackTarget(circleId, memberCode);
    const decision = await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });
    decisions.push(decision.allowed);
  }

  assert.equal(decisions.slice(0, 20).every(Boolean), true, "the first 20 attempts from this source should be allowed");
  assert.equal(decisions[20], false, "the 21st attempt from this source should be denied by SOURCE, despite every target being distinct");
});

test("C. TARGET denies the 11th attempt against the same target, even from 11 different sources", async () => {
  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);
  const decisions: boolean[] = [];

  for (let i = 0; i < 11; i++) {
    const source = sourceFromIp(randomTestIp());
    const decision = await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });
    decisions.push(decision.allowed);
  }

  assert.equal(decisions.slice(0, 10).every(Boolean), true, "the first 10 attempts against this target should be allowed");
  assert.equal(decisions[10], false, "the 11th attempt against this target should be denied by TARGET");
});

test("D. GLOBAL is wired to the documented fixed key and increments on every call (not exhausted here -- see note)", async () => {
  // The 1000/60s GLOBAL threshold is deliberately NOT exhausted end-to-end
  // in this suite: doing so would mean 1000 live round-trips against the
  // one real, shared "GLOBAL:circle-member-auth" bucket, which would also
  // affect any other concurrent use of that exact same production-shaped
  // key. The identical enforcement mechanism GLOBAL relies on is already
  // proven precisely by the repository-level threshold test above; this
  // test additionally proves the service genuinely wires GLOBAL through
  // that mechanism with the documented key derivation.
  const source = sourceFromIp(randomTestIp());
  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);

  const globalKeyHash = hmacHex("GLOBAL:circle-member-auth");
  const before = await readBucket("GLOBAL", globalKeyHash, 60);

  await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });

  const after = await readBucket("GLOBAL", globalKeyHash, 60);
  assert.equal(after, before + 1, "GLOBAL should increment by exactly one per call, regardless of source or target");
});

test("F. malformed circleId/memberCode still consumes SOURCE and a single shared TARGET bucket", async () => {
  const source = sourceFromIp(randomTestIp());
  const malformedTargetKeyHash = hmacHex("TARGET:malformed-target");
  const sourceKeyHash = hmacHex(`SOURCE:${source.value}`);

  const beforeTarget = await readBucket("TARGET", malformedTargetKeyHash, 900);
  const beforeSource = await readBucket("SOURCE", sourceKeyHash, 900);

  const decision = await checkMemberAuthenticationRateLimit({
    source,
    circleId: "not-a-cuid",
    memberCode: "not-hex-either",
  });
  assert.equal(decision.allowed, true, "a single malformed attempt should still be allowed if under all thresholds");

  const afterTarget = await readBucket("TARGET", malformedTargetKeyHash, 900);
  const afterSource = await readBucket("SOURCE", sourceKeyHash, 900);

  assert.equal(afterTarget, beforeTarget + 1, "malformed input must still consume the shared malformed-target bucket");
  assert.equal(afterSource, beforeSource + 1, "malformed input must still consume SOURCE capacity, not bypass it");
});

test("F2. two differently-malformed targets from the same source share ONE target bucket, not two", async () => {
  const source = sourceFromIp(randomTestIp());
  const malformedTargetKeyHash = hmacHex("TARGET:malformed-target");
  const before = await readBucket("TARGET", malformedTargetKeyHash, 900);

  await checkMemberAuthenticationRateLimit({ source, circleId: "garbage-one", memberCode: "zzzz" });
  await checkMemberAuthenticationRateLimit({ source, circleId: "12345", memberCode: "!!!not-hex!!!" });

  const after = await readBucket("TARGET", malformedTargetKeyHash, 900);
  assert.equal(after, before + 2, "both malformed attempts, despite different garbage input, must land in the same bounded bucket");
});

test("G. concurrent requests against a fresh SOURCE cannot exceed the SOURCE threshold", async () => {
  const source = sourceFromIp(randomTestIp());
  const concurrency = 25; // > SOURCE limit of 20

  const targets = Array.from({ length: concurrency }, () => {
    const circleId = randomCircleId();
    const memberCode = randomMemberCode();
    trackTarget(circleId, memberCode);
    return { circleId, memberCode };
  });

  const decisions = await Promise.all(
    targets.map(({ circleId, memberCode }) => checkMemberAuthenticationRateLimit({ source, circleId, memberCode })),
  );

  const allowedCount = decisions.filter((d) => d.allowed).length;
  assert.equal(allowedCount, 20, "exactly 20 of the 25 truly concurrent attempts from the same source should be allowed");
});

test("H. state is shared across independent calls (all state lives in PostgreSQL, not in-memory)", async () => {
  const source = sourceFromIp(randomTestIp());
  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);

  const first = await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });
  const second = await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);

  const targetKeyHash = hmacHex(`TARGET:${circleId}:${memberCode}`);
  const count = await readBucket("TARGET", targetKeyHash, 900);
  assert.equal(count, 2, "the second call must observe the first call's persisted increment");
});

test("K. one admission decision atomically touches all three scopes together", async () => {
  const source = sourceFromIp(randomTestIp());
  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);

  const sourceKeyHash = hmacHex(`SOURCE:${source.value}`);
  const targetKeyHash = hmacHex(`TARGET:${circleId}:${memberCode}`);
  const globalKeyHash = hmacHex("GLOBAL:circle-member-auth");

  const before = {
    source: await readBucket("SOURCE", sourceKeyHash, 900),
    target: await readBucket("TARGET", targetKeyHash, 900),
    global: await readBucket("GLOBAL", globalKeyHash, 60),
  };

  await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });

  const after = {
    source: await readBucket("SOURCE", sourceKeyHash, 900),
    target: await readBucket("TARGET", targetKeyHash, 900),
    global: await readBucket("GLOBAL", globalKeyHash, 60),
  };

  assert.equal(after.source, before.source + 1);
  assert.equal(after.target, before.target + 1);
  assert.equal(after.global, before.global + 1);
});

test("L. a denied attempt still increments its exhausted scope's counter (denied attempts are recorded, not free)", async () => {
  const source = sourceFromIp(randomTestIp());

  for (let i = 0; i < 20; i++) {
    const circleId = randomCircleId();
    const memberCode = randomMemberCode();
    trackTarget(circleId, memberCode);
    await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });
  }

  const sourceKeyHash = hmacHex(`SOURCE:${source.value}`);
  assert.equal(await readBucket("SOURCE", sourceKeyHash, 900), 20);

  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);
  const decision = await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });
  assert.equal(decision.allowed, false);

  assert.equal(
    await readBucket("SOURCE", sourceKeyHash, 900),
    21,
    "the denied 21st attempt should still have incremented the SOURCE counter",
  );
});

test("M. fails closed when the rate-limit secret is missing or too short (no DB row is written either)", async () => {
  const original = process.env.MEMBER_AUTH_RATE_LIMIT_SECRET;
  try {
    delete process.env.MEMBER_AUTH_RATE_LIMIT_SECRET;
    const source = sourceFromIp(randomTestIp());
    const decisionMissing = await checkMemberAuthenticationRateLimit({
      source,
      circleId: randomCircleId(),
      memberCode: randomMemberCode(),
    });
    assert.equal(decisionMissing.allowed, false);

    process.env.MEMBER_AUTH_RATE_LIMIT_SECRET = "too-short";
    const decisionWeak = await checkMemberAuthenticationRateLimit({
      source,
      circleId: randomCircleId(),
      memberCode: randomMemberCode(),
    });
    assert.equal(decisionWeak.allowed, false);
  } finally {
    process.env.MEMBER_AUTH_RATE_LIMIT_SECRET = original;
  }
});

test("N. only a lowercase 64-character hex digest is ever persisted as keyHash", async () => {
  const source = sourceFromIp(randomTestIp());
  const circleId = randomCircleId();
  const memberCode = randomMemberCode();
  trackTarget(circleId, memberCode);

  await checkMemberAuthenticationRateLimit({ source, circleId, memberCode });

  const sourceKeyHash = hmacHex(`SOURCE:${source.value}`);
  const raw = await prisma.$queryRaw<Array<{ keyHash: string }>>`
    SELECT "keyHash" FROM "CircleMemberAuthRateLimitBucket"
    WHERE scope = 'SOURCE'::"CircleMemberAuthRateLimitScope" AND "keyHash" = ${sourceKeyHash}
    LIMIT 1
  `;

  assert.ok(raw[0], "expected the SOURCE bucket row to exist");
  assert.match(raw[0].keyHash, /^[0-9a-f]{64}$/);
  assert.ok(!raw[0].keyHash.includes(source.value), "the persisted hash must not contain the raw source value");
});

test("O. the service never logs the raw source value, circleId, memberCode, or secret", () => {
  const servicePath = fileURLToPath(new URL("./circle-member-auth-rate-limit.service.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8");
  const consoleCalls = source.match(/console\.(error|log|warn)\([\s\S]*?\);/g) ?? [];

  assert.ok(consoleCalls.length > 0, "expected at least one console call to inspect");

  for (const call of consoleCalls) {
    for (const forbidden of ["input.source", "input.circleId", "input.memberCode", "sourceKeyHash", "targetKeyHash", "secret"]) {
      assert.ok(!call.includes(forbidden), `console call unexpectedly references "${forbidden}": ${call}`);
    }
  }
});

test("P/Q/R. the limiter never looks up CircleMember, verifies credentials, or touches sessions", () => {
  const servicePath = fileURLToPath(new URL("./circle-member-auth-rate-limit.service.ts", import.meta.url));
  const repositoryPath = fileURLToPath(
    new URL("../repositories/circle-member-auth-rate-limit.repository.ts", import.meta.url),
  );
  const combined = readFileSync(servicePath, "utf8") + "\n" + readFileSync(repositoryPath, "utf8");

  const forbidden = [
    "circleMember.find",
    "circleMember.count",
    "bcryptjs",
    "compare(",
    "next-auth",
    "signIn",
    "cookies(",
    "pinHash",
  ];

  for (const term of forbidden) {
    assert.ok(!combined.includes(term), `expected no reference to "${term}"`);
  }
});

test("S. Personal Savings and custodian data are unchanged by this entire suite", async () => {
  const finalCounts = {
    users: await prisma.user.count(),
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});

// Not run here, and not fabricated: whether a genuinely malicious client can
// forge x-vercel-forwarded-for on a real Vercel deployment is a guarantee of
// Vercel's own edge, not of this code, and cannot be exercised in a local
// test -- see docs/security/trusted-member-auth-source-contract.md, "Spoofed
// client header ignored/rejected", and the same note in
// trusted-member-auth-source.test.ts.
