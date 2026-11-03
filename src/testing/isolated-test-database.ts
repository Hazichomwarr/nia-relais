// Guards destructive limiter-cleanup tests against ever running against the
// shared application database. Test-support code only -- never imported by
// production services.
//
// Deliberately does NOT consult NODE_ENV: a test runner's environment name
// says nothing about which physical database a connection string points at,
// and inferring safety from it would be exactly the "merely NODE_ENV=test"
// shortcut this guard exists to avoid. Safety is instead established
// positively, from the actual configured connection targets.

export type IsolatedTestDatabaseCheck =
  | { readonly isolated: true; readonly connectionString: string }
  | { readonly isolated: false; readonly reason: string };

function hostnameOf(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Positive-only safety check: an isolated test database is one that is
 * explicitly configured via TEST_DATABASE_URL after the Node test bootstrap
 * has positively verified its Neon branch identity. The bootstrap compares
 * actual `neon.branch_id` values for the test, pooled, and direct targets;
 * that is stronger than a hostname comparison and remains safe if endpoints
 * are renamed or rotated.
 *
 * This helper still validates that TEST_DATABASE_URL is syntactically valid,
 * but it intentionally does not attempt to re-prove identity from the URL.
 * The bootstrap is the only layer that opens read-only connections and checks
 * the provider's branch metadata before test modules can import Prisma.
 */
export function checkIsolatedTestDatabaseConfiguration(): IsolatedTestDatabaseCheck {
  const testUrl = process.env.TEST_DATABASE_URL;

  if (process.env.NIA_TEST_DATABASE_IDENTITY_VERIFIED !== "1") {
    return {
      isolated: false,
      reason:
        "The test database identity bootstrap did not verify a dedicated Neon branch. Refusing to run a database-writing test directly.",
    };
  }

  if (!testUrl || testUrl.trim().length === 0) {
    return {
      isolated: false,
      reason:
        "TEST_DATABASE_URL is not set. Destructive limiter-cleanup tests require an explicit, isolated test database and refuse to run without one.",
    };
  }

  const testHost = hostnameOf(testUrl);
  if (!testHost) {
    return {
      isolated: false,
      reason: "TEST_DATABASE_URL is not a valid connection URL.",
    };
  }

  return { isolated: true, connectionString: testUrl };
}
