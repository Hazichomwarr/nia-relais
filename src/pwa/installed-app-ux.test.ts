import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installed shell protects top and bottom mobile controls without a separate app shell", async () => {
  const [root, appLayout, navigation, memberDashboard, indicator] = await Promise.all([
    readFile("app/layout.tsx", "utf8"),
    readFile("app/(app)/layout.tsx", "utf8"),
    readFile("app/(app)/app-navigation.tsx", "utf8"),
    readFile("app/member/circles/[circleId]/member-dashboard.tsx", "utf8"),
    readFile("components/pwa/connectivity-indicator.tsx", "utf8"),
  ]);

  assert.match(root, /min-h-\[100dvh\]/);
  assert.match(appLayout, /min-h-\[100dvh\]/);
  assert.match(navigation, /safe-area-inset-top/);
  assert.match(memberDashboard, /safe-area-inset-bottom/);
  assert.match(memberDashboard, /pb-\[calc\(6rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(indicator, /safe-area-inset-top/);
});

test("installed mode does not add a second session, cache, or install-prompt architecture", async () => {
  const [registration, worker, manifest] = await Promise.all([
    readFile("components/pwa/service-worker-registration.tsx", "utf8"),
    readFile("public/sw.js", "utf8"),
    readFile("app/manifest.ts", "utf8"),
  ]);

  assert.match(registration, /NODE_ENV !== "production"/);
  assert.match(manifest, /start_url: "\/"/);
  assert.doesNotMatch(registration, /beforeinstallprompt|localStorage|indexedDB/i);
  assert.doesNotMatch(worker, /self\.skipWaiting|clients\.claim|addEventListener\("sync"/);
});
