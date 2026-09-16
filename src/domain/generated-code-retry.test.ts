import assert from "node:assert/strict";
import test from "node:test";

import { GeneratedCodeExhaustedError, withGeneratedCodeRetry } from "./generated-code-retry";

// Pure, DB-free tests: `attempt` and `isCollision` are hand-written test
// doubles standing in for a real Prisma insert and a real P2002 check, per
// 10E's own "CODE GENERATION AUTHORITY" contract -- generate, then attempt
// the real insert, retry ONLY on a genuine collision reported by the
// caller's own predicate, never a separate unprotected pre-check.

class FakeCollisionError extends Error {}
class OtherError extends Error {}

test("a candidate that collides once is regenerated and the retry succeeds", async () => {
  const generated: number[] = [];
  let calls = 0;

  const result = await withGeneratedCodeRetry({
    maxAttempts: 5,
    generate: () => {
      const candidate = generated.length;
      generated.push(candidate);
      return candidate;
    },
    attempt: async (candidate) => {
      calls += 1;
      if (candidate === 0) throw new FakeCollisionError();
      return `persisted-${candidate}`;
    },
    isCollision: (error) => error instanceof FakeCollisionError,
  });

  assert.equal(result, "persisted-1");
  assert.equal(calls, 2);
  assert.deepEqual(generated, [0, 1]);
});

test("multiple consecutive collisions are each regenerated until one succeeds", async () => {
  let calls = 0;
  const COLLISIONS_BEFORE_SUCCESS = 4;

  const result = await withGeneratedCodeRetry({
    maxAttempts: 5,
    generate: () => calls,
    attempt: async (candidate) => {
      calls += 1;
      if (candidate < COLLISIONS_BEFORE_SUCCESS) throw new FakeCollisionError();
      return `persisted-${candidate}`;
    },
    isCollision: (error) => error instanceof FakeCollisionError,
  });

  assert.equal(result, "persisted-4");
  assert.equal(calls, 5, "expected 4 collisions plus the 1 successful attempt");
});

// A "concurrent database unique violation" is, from this helper's point of
// view, indistinguishable from any other collision reported by
// `isCollision` -- there is no separate code path for it, which is exactly
// the point (10E: never check -> assume safe -> insert unprotected).
test("a collision reported on every attempt (simulating sustained concurrent contention) is retried up to the bound", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      withGeneratedCodeRetry({
        maxAttempts: 5,
        generate: () => calls,
        attempt: async () => {
          calls += 1;
          throw new FakeCollisionError();
        },
        isCollision: (error) => error instanceof FakeCollisionError,
      }),
    GeneratedCodeExhaustedError,
  );

  assert.equal(calls, 5, "expected exactly maxAttempts attempts, no more");
});

test("retry exhaustion fails safely with GeneratedCodeExhaustedError, never returning an unpersisted/potentially-duplicated candidate", async () => {
  await assert.rejects(
    () =>
      withGeneratedCodeRetry({
        maxAttempts: 3,
        generate: () => "candidate",
        attempt: async () => {
          throw new FakeCollisionError();
        },
        isCollision: () => true,
      }),
    GeneratedCodeExhaustedError,
  );
});

test("a non-collision error is never retried and propagates immediately", async () => {
  let calls = 0;
  const boom = new OtherError("unexpected database failure");

  await assert.rejects(
    () =>
      withGeneratedCodeRetry({
        maxAttempts: 5,
        generate: () => "candidate",
        attempt: async () => {
          calls += 1;
          throw boom;
        },
        isCollision: (error) => error instanceof FakeCollisionError,
      }),
    boom,
  );

  assert.equal(calls, 1, "a non-collision failure must not be retried");
});

test("the handed-back result is exactly the successfully persisted attempt's own return value", async () => {
  const result = await withGeneratedCodeRetry({
    maxAttempts: 5,
    generate: () => "the-candidate",
    attempt: async (candidate) => ({ persistedCode: candidate, id: "row-1" }),
    isCollision: () => false,
  });

  assert.deepEqual(result, { persistedCode: "the-candidate", id: "row-1" });
});

test("a zero-collision first attempt calls generate and attempt exactly once", async () => {
  let generateCalls = 0;
  let attemptCalls = 0;

  await withGeneratedCodeRetry({
    maxAttempts: 5,
    generate: () => {
      generateCalls += 1;
      return "candidate";
    },
    attempt: async () => {
      attemptCalls += 1;
      return "ok";
    },
    isCollision: () => false,
  });

  assert.equal(generateCalls, 1);
  assert.equal(attemptCalls, 1);
});
