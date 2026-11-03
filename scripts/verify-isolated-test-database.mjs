// Fail closed before the standard test command loads any test module that can
// write through src/prisma.ts. This intentionally verifies the actual Neon
// branch IDs, not NODE_ENV, database name, or hostname alone.
import "dotenv/config";
import { verifyIsolatedTestDatabaseIdentity } from "./test-database-identity.mjs";

try {
  await verifyIsolatedTestDatabaseIdentity();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Refusing to run tests: test database identity verification failed.");
  process.exit(1);
}
