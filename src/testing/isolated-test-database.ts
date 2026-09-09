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
 * explicitly configured via TEST_DATABASE_URL AND whose connection target
 * (compared by hostname, not raw string equality, so query-string or
 * credential differences can't mask the same underlying server) is
 * verifiably distinct from both the pooled (DATABASE_URL) and direct
 * (DIRECT_URL) production connections.
 *
 * Comparing hostnames rather than full connection strings or database names
 * matters specifically for this project's database (Neon): every branch of
 * a Neon project can be named identically ("neondb" by default), so
 * comparing database names alone could treat two genuinely different
 * physical databases as "the same" (a false negative) or, worse, the
 * default name being shared could mask a real collision if compared
 * naively. The hostname is what Neon uses to route to a specific
 * project/branch's compute endpoint, so it is the correct identity signal
 * for "is this actually the same database instance."
 */
export function checkIsolatedTestDatabaseConfiguration(): IsolatedTestDatabaseCheck {
  const testUrl = process.env.TEST_DATABASE_URL;

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

  const productionHost = hostnameOf(process.env.DATABASE_URL);
  const directHost = hostnameOf(process.env.DIRECT_URL);

  if (testHost === productionHost || testHost === directHost) {
    return {
      isolated: false,
      reason: `TEST_DATABASE_URL resolves to the same host ("${testHost}") as the configured production database. Refusing to treat this as isolated.`,
    };
  }

  return { isolated: true, connectionString: testUrl };
}
