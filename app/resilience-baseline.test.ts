import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import nextConfig from "../next.config";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("security headers are configured for every route", async () => {
  assert.ok(nextConfig.headers, "expected next.config.ts to define headers");
  const rules = await nextConfig.headers!();
  const rule = rules.find((candidate) => candidate.source === "/:path*");
  assert.ok(rule, "expected a site-wide header rule");

  const headers = new Map(rule.headers.map((header) => [header.key, header.value]));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("Permissions-Policy"), "camera=(), geolocation=(), microphone=(), payment=()");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
});

test("resilience boundaries offer safe recovery without rendering raw errors", () => {
  const appError = source("./(app)/error.tsx");
  const memberError = source("./member/error.tsx");
  const globalError = source("./global-error.tsx");

  for (const boundary of [appError, memberError, globalError]) {
    assert.match(boundary, /unstable_retry/);
    assert.match(boundary, /RecoveryPanel/);
    assert.doesNotMatch(boundary, /error\.message/);
    assert.doesNotMatch(boundary, /error\.stack/);
  }

  assert.match(appError, /returnHref="\/dashboard"/);
  assert.match(memberError, /returnHref="\/member\/login"/);
});

test("priority route segments have lightweight accessible loading states", () => {
  for (const path of [
    "./(app)/dashboard/loading.tsx",
    "./(app)/goals/[goalId]/loading.tsx",
    "./(app)/circles/[circleId]/loading.tsx",
    "./member/circles/[circleId]/loading.tsx",
  ]) {
    const loading = source(path);
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /aria-live="polite"/);
  }
});

test("the root not-found page remains generic and offers a safe recovery path", () => {
  const notFound = source("./not-found.tsx");
  assert.match(notFound, /We couldn’t find that page/);
  assert.match(notFound, /href="\/"/);
  assert.doesNotMatch(notFound, /owner|authorization|database/i);
});
