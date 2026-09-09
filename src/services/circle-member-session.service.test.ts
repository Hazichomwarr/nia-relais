import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createCircleMemberSession,
  validateCircleMemberSession,
  revokeCircleMemberSessionByToken,
  revokeAllCircleMemberSessions,
  CircleMemberSessionMemberNotFoundError,
  CircleMemberSessionMemberNotActiveError,
  CircleMemberSessionCircleNotEligibleError,
  CircleMemberSessionCredentialVersionMismatchError,
} from "@/src/services/circle-member-session.service";
import { prisma } from "@/src/prisma";

// Temporary fixtures, precisely scoped by unique generated ids, deleted in
// `test.after` regardless of individual test outcome. Nothing here performs
// a broad/unscoped delete against shared state -- every cleanup targets
// exactly the rows this file created.

const ownedResourceIds = { userIds: new Set<string>(), circleIds: new Set<string>() };

function unique(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

async function createOwner() {
  const owner = await prisma.user.create({
    data: { name: "SESSION_TEST_OWNER", email: `${unique("session-test-owner")}@example.invalid` },
    select: { id: true },
  });
  ownedResourceIds.userIds.add(owner.id);
  return owner.id;
}

async function createFixtureCircle(ownerId: string, status: "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED") {
  const circle = await prisma.savingsCircle.create({
    data: {
      ownerId,
      name: unique("SessionTestCircle"),
      currency: "USD",
      contributionAmount: "10.00",
      frequency: "WEEKLY",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status,
    },
    select: { id: true },
  });
  ownedResourceIds.circleIds.add(circle.id);
  return circle.id;
}

async function createFixtureMember(
  circleId: string,
  ownerId: string,
  options?: { status?: "ACTIVE" | "REMOVED"; credentialVersion?: number },
) {
  const member = await prisma.circleMember.create({
    data: {
      circleId,
      displayName: "Session Test Member",
      memberCode: unique("CODE").toUpperCase().slice(0, 16).padEnd(16, "0"),
      pinHash: "not-a-real-hash",
      status: options?.status ?? "ACTIVE",
      credentialVersion: options?.credentialVersion ?? 1,
      addedById: ownerId,
    },
    select: { id: true, credentialVersion: true },
  });
  return member;
}

async function fixture(
  circleStatus: "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED" | "CANCELLED",
  memberOptions?: { status?: "ACTIVE" | "REMOVED"; credentialVersion?: number },
) {
  const ownerId = await createOwner();
  const circleId = await createFixtureCircle(ownerId, circleStatus);
  const member = await createFixtureMember(circleId, ownerId, memberOptions);
  return { ownerId, circleId, memberId: member.id, credentialVersion: member.credentialVersion };
}

let baselineCounts: { users: number; goals: number; deposits: number; custodians: number };

test.before(async () => {
  baselineCounts = {
    users: await prisma.user.count(),
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
});

test.after(async () => {
  // FK-safe order: sessions -> members -> circles -> users.
  const circleIds = [...ownedResourceIds.circleIds];
  if (circleIds.length > 0) {
    await prisma.circleMemberSession.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.circleMember.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.savingsCircle.deleteMany({ where: { id: { in: circleIds } } });
  }
  const userIds = [...ownedResourceIds.userIds];
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

test("A. valid session issuance succeeds for an ACTIVE member in an ACTIVE circle", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  assert.ok(session.sessionId);
  assert.ok(session.rawToken.length > 0);
  assert.equal(session.circleId, f.circleId);
  assert.equal(session.memberId, f.memberId);
  assert.ok(new Date(session.expiresAt).getTime() > Date.now());
});

test("B. the raw token is never persisted", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  const row = await prisma.circleMemberSession.findUnique({
    where: { id: session.sessionId },
    select: { tokenHash: true },
  });

  assert.ok(row);
  assert.notEqual(row.tokenHash, session.rawToken);
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/, "tokenHash must be a SHA-256 hex digest, not the raw token");
});

test("C. tokenHash lookup resolves the session (validation succeeds with the raw token)", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.identity, { circleId: f.circleId, memberId: f.memberId });
  }
});

test("D. an unknown/invalid token is denied", async () => {
  const result = await validateCircleMemberSession(randomBytes(32).toString("base64url"));
  assert.equal(result.valid, false);
});

test("E. an expired session is denied", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  await prisma.circleMemberSession.update({
    where: { id: session.sessionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, false);
});

test("F. a revoked session is denied", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  const revocation = await revokeCircleMemberSessionByToken(session.rawToken);
  assert.equal(revocation.revoked, true);

  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, false);
});

test("G. a removed member's session is denied even though the token itself is still fresh", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  await prisma.circleMember.update({ where: { id: f.memberId }, data: { status: "REMOVED" } });

  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, false);
});

test("H. a credentialVersion mismatch (e.g. after a PIN change) is denied", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });

  await prisma.circleMember.update({ where: { id: f.memberId }, data: { credentialVersion: f.credentialVersion + 1 } });

  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, false);
});

test("I. ACTIVE circle allows issuance and validation", async () => {
  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });
  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, true);
});

test("J. COMPLETED circle allows issuance and validation", async () => {
  const f = await fixture("COMPLETED");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });
  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, true);
});

test("K. ARCHIVED circle allows issuance and validation", async () => {
  const f = await fixture("ARCHIVED");
  const session = await createCircleMemberSession({
    circleId: f.circleId,
    memberId: f.memberId,
    credentialVersion: f.credentialVersion,
  });
  const result = await validateCircleMemberSession(session.rawToken);
  assert.equal(result.valid, true);
});

test("L. DRAFT circle denies issuance", async () => {
  const f = await fixture("DRAFT");
  await assert.rejects(
    () => createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion }),
    CircleMemberSessionCircleNotEligibleError,
  );
});

test("L2. CANCELLED circle denies issuance (excluded by the same allowlist)", async () => {
  const f = await fixture("CANCELLED");
  await assert.rejects(
    () => createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion }),
    CircleMemberSessionCircleNotEligibleError,
  );
});

test("M. a cross-circle mismatch (real member, wrong circleId) is denied as member-not-found", async () => {
  const fA = await fixture("ACTIVE");
  const fB = await fixture("ACTIVE");

  await assert.rejects(
    () => createCircleMemberSession({ circleId: fB.circleId, memberId: fA.memberId, credentialVersion: fA.credentialVersion }),
    CircleMemberSessionMemberNotFoundError,
  );
});

test("N. revoking one session denies only that session, leaving another session for the same member valid", async () => {
  const f = await fixture("ACTIVE");
  const sessionOne = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });
  const sessionTwo = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });

  await revokeCircleMemberSessionByToken(sessionOne.rawToken);

  const resultOne = await validateCircleMemberSession(sessionOne.rawToken);
  const resultTwo = await validateCircleMemberSession(sessionTwo.rawToken);

  assert.equal(resultOne.valid, false);
  assert.equal(resultTwo.valid, true);
});

test("O. revoking all sessions for a member denies every session for that member", async () => {
  const f = await fixture("ACTIVE");
  const sessionOne = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });
  const sessionTwo = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });

  const revocation = await revokeAllCircleMemberSessions({ circleId: f.circleId, memberId: f.memberId });
  assert.equal(revocation.revokedCount, 2);

  const resultOne = await validateCircleMemberSession(sessionOne.rawToken);
  const resultTwo = await validateCircleMemberSession(sessionTwo.rawToken);
  assert.equal(resultOne.valid, false);
  assert.equal(resultTwo.valid, false);
});

test("P. one member may hold multiple simultaneously-valid sessions", async () => {
  const f = await fixture("ACTIVE");
  const sessionOne = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });
  const sessionTwo = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });

  const resultOne = await validateCircleMemberSession(sessionOne.rawToken);
  const resultTwo = await validateCircleMemberSession(sessionTwo.rawToken);
  assert.equal(resultOne.valid, true);
  assert.equal(resultTwo.valid, true);
  assert.notEqual(sessionOne.sessionId, sessionTwo.sessionId);
});

test("Precondition: REMOVED member is denied issuance outright", async () => {
  const f = await fixture("ACTIVE", { status: "REMOVED" });
  await assert.rejects(
    () => createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion }),
    CircleMemberSessionMemberNotActiveError,
  );
});

test("Precondition: a stale credentialVersion is rejected at issuance", async () => {
  const f = await fixture("ACTIVE", { credentialVersion: 3 });
  await assert.rejects(
    () => createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: 1 }),
    CircleMemberSessionCredentialVersionMismatchError,
  );
});

/**
 * Strips `//` and `/* *\/` comments before a structural substring search, so
 * a source file's own explanatory prose (which may need to *name* a
 * forbidden import or field to explain why it's absent) can't produce a
 * false positive against the same check it's describing.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("Q. session issuance/validation never touches platform User rows and never imports Auth.js", async () => {
  const servicePath = fileURLToPath(new URL("./circle-member-session.service.ts", import.meta.url));
  const code = stripComments(readFileSync(servicePath, "utf8"));
  for (const forbidden of ["next-auth", "@/auth", "next/headers", "signIn", "getVerifiedUser", "requireUser"]) {
    assert.ok(!code.includes(forbidden), `expected no reference to "${forbidden}" outside comments`);
  }

  const usersBefore = await prisma.user.count();
  const f = await fixture("ACTIVE");
  await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });
  const usersAfter = await prisma.user.count();

  // The fixture itself creates exactly one owner User row; session issuance
  // must not create or modify any additional User row beyond that.
  assert.equal(usersAfter, usersBefore + 1);
});

test("R. no pinHash, memberCode, or email is ever returned by validation or present in the repository's select", async () => {
  const repositoryPath = fileURLToPath(new URL("../repositories/circle-member-session.repository.ts", import.meta.url));
  const code = stripComments(readFileSync(repositoryPath, "utf8"));
  for (const forbidden of ["pinHash", "memberCode", "email:"]) {
    assert.ok(!code.includes(forbidden), `repository selects must not reference "${forbidden}" outside comments`);
  }

  const f = await fixture("ACTIVE");
  const session = await createCircleMemberSession({ circleId: f.circleId, memberId: f.memberId, credentialVersion: f.credentialVersion });
  const result = await validateCircleMemberSession(session.rawToken);

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(Object.keys(result.identity).sort(), ["circleId", "memberId"]);
  }
});

test("S. this suite makes no financial/domain lifecycle mutation outside the SUSU tables it created", async () => {
  const finalCounts = {
    users: (await prisma.user.count()) - ownedResourceIds.userIds.size, // exclude this file's own fixture owners
    goals: await prisma.personalGoal.count(),
    deposits: await prisma.deposit.count(),
    custodians: await prisma.goalCustodian.count(),
  };
  assert.deepEqual(finalCounts, baselineCounts);
});
