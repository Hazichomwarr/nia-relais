import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
Object.assign(globalThis, { location: new URL("https://nia.example") });
const policy = require("../../public/sw-policy.js") as {
  CACHE_NAME: string;
  CACHE_PREFIX: string;
  classifyRequest: (request: { method: string }, url: URL) => "immutable" | "brand" | null;
  isNiaCacheName: (cacheName: string) => boolean;
  isSafeResponse: (response: Response) => boolean;
};

const origin = "https://nia.example";
const request = (path: string, method = "GET") => ({ method, url: new URL(path, origin) });
const classify = (path: string, method = "GET") => {
  const value = request(path, method);
  return policy.classifyRequest(value, value.url);
};

test("cache policy only allows explicitly safe NIA assets", () => {
  assert.equal(classify("/_next/static/chunks/app-abc.js"), "immutable");
  assert.equal(classify("/_next/static/media/font-abc.woff2"), "immutable");
  assert.equal(classify("/icons/nia-512.png"), "brand");
  assert.equal(classify("/images/nia-logo.png"), "brand");
  assert.equal(classify("/images/nia-hero.png"), "brand");
  assert.equal(classify("/images/other-public-image.png"), null);
});

test("cache policy keeps navigations, data, auth, and mutations network-authoritative", () => {
  for (const path of [
    "/dashboard",
    "/goals/example",
    "/deposits",
    "/circles/example",
    "/member/circles/example",
    "/api/auth/session",
    "/api/member/auth/login",
    "/login?_rsc=flight",
  ]) {
    assert.equal(classify(path), null, path);
  }

  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.equal(classify("/icons/nia-512.png", method), null, method);
  }

  assert.equal(policy.classifyRequest({ method: "GET" }, new URL("https://cdn.example/asset.js")), null);
});

test("cache names are versioned and cleanup is limited to NIA-owned caches", () => {
  assert.equal(policy.CACHE_NAME, "nia-static-v2");
  assert.equal(policy.CACHE_PREFIX, "nia-static-");
  assert.equal(policy.isNiaCacheName("nia-static-v0"), true);
  assert.equal(policy.isNiaCacheName("another-app-v1"), false);
});

test("only successful, same-origin-safe responses are cacheable", () => {
  const safeResponse = (overrides: Partial<Response> = {}) =>
    ({
      ok: true,
      redirected: false,
      type: "basic",
      headers: new Headers(),
      ...overrides,
    }) as Response;

  assert.equal(policy.isSafeResponse(safeResponse()), true);
  assert.equal(policy.isSafeResponse(safeResponse({ ok: false })), false);
  assert.equal(
    policy.isSafeResponse(safeResponse({ headers: new Headers({ "cache-control": "private" }) })),
    false,
  );
  assert.equal(
    policy.isSafeResponse(safeResponse({ headers: new Headers({ "cache-control": "no-store" }) })),
    false,
  );
});

test("the worker and its registration contain no offline mutation or takeover behavior", async () => {
  const [workerSource, registrationSource, offlineSource, indicatorSource] = await Promise.all([
    readFile("public/sw.js", "utf8"),
    readFile("components/pwa/service-worker-registration.tsx", "utf8"),
    readFile("public/offline.html", "utf8"),
    readFile("components/pwa/connectivity-indicator.tsx", "utf8"),
  ]);

  assert.match(workerSource, /importScripts\("\/sw-policy\.js"\)/);
  assert.doesNotMatch(workerSource, /self\.skipWaiting|clients\.claim|addEventListener\("sync"/);
  assert.match(registrationSource, /process\.env\.NODE_ENV !== "production"/);
  assert.match(registrationSource, /register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(workerSource, /event\.request\.mode === "navigate"/);
  assert.match(workerSource, /caches\.match\(OFFLINE_FALLBACK_PATH\)/);
  assert.match(offlineSource, /location\.reload\(\)/);
  assert.match(offlineSource, /Vous êtes hors ligne/);
  assert.match(offlineSource, /You’re offline/);
  assert.doesNotMatch(offlineSource, /dashboard|contribution|payout|balance|member list/i);
  assert.match(indicatorSource, /addEventListener\("offline"/);
  assert.match(indicatorSource, /addEventListener\("online"/);
  assert.doesNotMatch(indicatorSource, /fetch\(|submit|replay/i);
});
