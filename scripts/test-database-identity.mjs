import { Client } from "pg";

function hostnameOf(connectionString) {
  if (!connectionString || connectionString.trim().length === 0) return null;

  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function neonBranchId(connectionString) {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const result = await client.query("SELECT current_setting('neon.branch_id', true) AS branch_id");
    return result.rows[0]?.branch_id ?? null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Positively verify the physical Neon identity of the test target before any
 * database-writing test module can load. A different hostname alone is not a
 * sufficient guarantee: endpoints can change while retaining the same branch.
 */
export async function verifyIsolatedTestDatabaseIdentity(environment = process.env) {
  const testUrl = environment.TEST_DATABASE_URL;
  const applicationUrl = environment.DATABASE_URL;
  const directUrl = environment.DIRECT_URL;
  const expectedTestBranchId = environment.NIA_TEST_DATABASE_BRANCH_ID;
  const testHost = hostnameOf(testUrl);
  const applicationHosts = [hostnameOf(applicationUrl), hostnameOf(directUrl)].filter(Boolean);

  if (!testHost) {
    throw new Error("Refusing to run tests: TEST_DATABASE_URL must be a valid, explicitly configured isolated database URL.");
  }

  if (!expectedTestBranchId || !/^br-[a-z0-9-]+$/.test(expectedTestBranchId)) {
    throw new Error("Refusing to run tests: NIA_TEST_DATABASE_BRANCH_ID must explicitly identify the dedicated Neon test branch.");
  }

  if (applicationHosts.includes(testHost)) {
    throw new Error("Refusing to run tests: TEST_DATABASE_URL resolves to an application database host.");
  }

  const [applicationBranchId, directBranchId, testBranchId] = await Promise.all([
    neonBranchId(applicationUrl),
    neonBranchId(directUrl),
    neonBranchId(testUrl),
  ]);

  if (!applicationBranchId || !directBranchId || applicationBranchId !== directBranchId) {
    throw new Error("Refusing to run tests: configured application database identity could not be verified consistently.");
  }

  if (!testBranchId || testBranchId !== expectedTestBranchId) {
    throw new Error("Refusing to run tests: TEST_DATABASE_URL does not resolve to NIA_TEST_DATABASE_BRANCH_ID.");
  }

  if (testBranchId === applicationBranchId) {
    throw new Error("Refusing to run tests: TEST_DATABASE_URL resolves to the configured application Neon branch.");
  }
}
