import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";

const source = readFileSync(new URL("./register-form.tsx", import.meta.url), "utf8");

test("platform registration offers the localized platform login route, never member login", () => {
  assert.equal(en.register.existingAccount, "Already have an account?");
  assert.equal(fr.register.existingAccount, "Vous avez déjà un compte ?");
  assert.match(source, /href="\/login"/);
  assert.doesNotMatch(source, /member\/login/);
});
