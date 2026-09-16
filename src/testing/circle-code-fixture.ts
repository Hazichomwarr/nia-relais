import { randomBytes } from "node:crypto";

// Shared test-only helper: SavingsCircle.circleCode (10E) is NOT NULL,
// globally unique, and database-CHECK-constrained to the exact
// "NIA-XXXX" shape (see the 20260915030000_susu_circle_code_credentials
// migration) -- every test fixture that creates a SavingsCircle row
// directly via prisma.savingsCircle.create must supply a value matching
// that shape, the same way existing fixtures already supply a unique
// name/email. This intentionally reuses the exact restricted alphabet
// circle.service.ts's real generateCircleCode() draws from
// (src/validations/circle-member-auth.schema.ts's HUMAN_CODE_ALPHABET),
// not a redefinition of it, so a fixture code is always a value the real
// generator could plausibly have produced.

import { HUMAN_CODE_ALPHABET } from "@/src/validations/circle-member-auth.schema";

/**
 * A random, syntactically valid test circleCode ("NIA-XXXX"). Not
 * collision-checked against existing rows -- the 923,521-value namespace
 * (31^4) makes an accidental collision within one test run's small fixture
 * count negligible, matching how existing `unique()` name/email fixture
 * helpers in this test suite already rely on randomness rather than an
 * explicit uniqueness check.
 */
export function randomTestCircleCode(): string {
  const bytes = randomBytes(4);
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += HUMAN_CODE_ALPHABET[bytes[index] % HUMAN_CODE_ALPHABET.length];
  }
  return `NIA-${code}`;
}
