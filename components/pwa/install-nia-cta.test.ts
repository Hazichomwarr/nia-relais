import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

test("install CTA preserves the native prompt and iOS instruction boundaries", async () => {
  const source = await readFile("components/pwa/install-nia-cta.tsx", "utf8");
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /preventDefault\(\)/);
  assert.match(source, /await prompt\.prompt\(\)/);
  assert.match(source, /userChoice/);
  assert.match(source, /display-mode: standalone/);
  assert.match(source, /navigator.*standalone/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.doesNotMatch(source, /localStorage|indexedDB|serviceWorker|cache/i);
});

test("install copy remains typed and complete in English and French", () => {
  assert.equal(en.landing.installNia, "Install NIA");
  assert.equal(fr.landing.installNia, "Installer NIA");
  assert.match(en.landing.installStepTwo, /Add to Home Screen/);
  assert.match(fr.landing.installStepTwo, /Sur l’écran d’accueil/);
});
