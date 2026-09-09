import "server-only";

import { createRequire } from "node:module";

import { cookies } from "next/headers";

import { CIRCLE_MEMBER_SESSION_COOKIE_NAME } from "@/src/auth/circle-member-session-cookie";
import { validateCircleMemberSession } from "@/src/services/circle-member-session.service";

// next/navigation's redirect() is deliberately NOT imported at the top of
// this file. Loading it (even just to read the export) pulls in
// next/dist/client/components/navigation.js, which constructs a React
// context at module-evaluation time -- something that crashes outside a
// real Next.js server runtime (e.g. under the plain Node test harness's
// --conditions=react-server flag, needed so "server-only" above resolves
// as a no-op instead of throwing). Deferring the require into
// redirectToRealLogin() below means it is only ever touched by an actual
// production redirect -- every test in require-circle-member.test.ts
// supplies its own redirectToLogin and never reaches this function, so the
// module can be imported and unit-tested without ever loading
// next/navigation at all.
const requireNextModule = createRequire(import.meta.url);

// The SUSU member-facing counterpart to requireGoalOwner/requireUser -- but
// built entirely on the member session primitive (7G.3/7G.4), never on
// Auth.js or platform User identity. Nothing in this file imports
// next-auth or @/auth.

export type CircleMemberIdentity = {
  readonly circleId: string;
  readonly memberId: string;
};

// Injectable only so the ordering/failure behavior below can be unit-tested
// without a real request context or a live database -- see
// require-circle-member.test.ts. Production call sites never pass a second
// argument and always get the real cookie jar, the real (unmodified)
// validateCircleMemberSession, and the real redirect.
export type RequireCircleMemberDependencies = {
  readonly readSessionCookie: () => Promise<string | undefined>;
  readonly validateSession: typeof validateCircleMemberSession;
  readonly redirectToLogin: () => never;
};

function redirectToRealLogin(): never {
  const { redirect } = requireNextModule("next/navigation") as typeof import("next/navigation");
  return redirect("/member/login");
}

const defaultDependencies: RequireCircleMemberDependencies = {
  readSessionCookie: async () => (await cookies()).get(CIRCLE_MEMBER_SESSION_COOKIE_NAME)?.value,
  validateSession: validateCircleMemberSession,
  redirectToLogin: redirectToRealLogin,
};

/**
 * Authorizes the current request against exactly one circle, deriving
 * memberId ONLY from the validated member session -- there is no memberId
 * parameter to this function, so there is nothing for a caller to
 * (incorrectly) supply.
 *
 * validateCircleMemberSession (unmodified, called as-is) already re-checks,
 * on every call, against fresh database state: the session is unexpired
 * and unrevoked, the member's current status is ACTIVE, the member's
 * credentialVersion still matches, and the circle's current status is one
 * of ACTIVE/COMPLETED/ARCHIVED (DRAFT and CANCELLED excluded by omission).
 * This function adds exactly one check on top, which
 * validateCircleMemberSession has no way to make on its own: that the
 * session's own trusted circleId matches the circleId being requested --
 * without it, a valid session for circle A could read circle B's dashboard.
 *
 * Every failure -- missing cookie, invalid/expired/revoked session, removed
 * member, ineligible circle status, or a cross-circle mismatch -- is
 * indistinguishable from the outside: all of them redirect to
 * /member/login, matching the existing member-namespace behavior
 * established by app/member/circles/[circleId]/page.tsx in 7G.5. This
 * never reveals whether the requested circleId corresponds to a real
 * circle.
 */
export async function requireCircleMember(
  circleId: string,
  dependencies: Partial<RequireCircleMemberDependencies> = {},
): Promise<CircleMemberIdentity> {
  const deps = { ...defaultDependencies, ...dependencies };

  const rawToken = await deps.readSessionCookie();
  const result = rawToken ? await deps.validateSession(rawToken) : ({ valid: false } as const);

  if (!result.valid || result.identity.circleId !== circleId) {
    deps.redirectToLogin();
    throw new Error("unreachable: redirectToLogin must never return");
  }

  return { circleId: result.identity.circleId, memberId: result.identity.memberId };
}
