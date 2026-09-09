// Cookie CONTRACT ONLY for the future SUSU member login (7G.3, Section 9).
// Not wired into any route, action, or response yet -- there is no public
// member login in this ticket. This module defines what that future cookie
// must look like so the login-wiring ticket doesn't have to decide it fresh.
//
// Deliberately framework-agnostic (no `next/headers` import): the shape
// below is a plain options object compatible with Next's `cookies().set(name,
// value, options)`, but importing that API here would tie a pure contract
// module to a request context it doesn't have and doesn't need yet.

/** Distinct from Auth.js's own cookie name -- never reuse it. */
export const CIRCLE_MEMBER_SESSION_COOKIE_NAME = "nia_member_session";

/**
 * The cookie's VALUE must be the opaque raw session token returned once by
 * `createCircleMemberSession` -- and nothing else. Never circleId, memberId,
 * a JSON blob, or any other identity material: the token is meaningless on
 * its own to an observer and only resolves to an identity via
 * `validateCircleMemberSession`'s server-side lookup.
 */
export const CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  // Off in development so the cookie still works over plain http://localhost;
  // browsers reject `Secure` cookies on non-HTTPS origins.
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // Path decision (7G.4): deliberately "/", not a narrower prefix. The
  // login API lives at /api/member/auth/login and the future member-facing
  // pages will live under /member/... (e.g. /member/circles/[circleId]) --
  // two disjoint prefixes with no shared ancestor narrower than "/" that
  // covers both where this cookie must be readable. Scoping to
  // /api/member would hide the cookie from the member pages that need to
  // send it on every request; scoping to /member would hide it from the
  // API route that sets it. "/" is the honest answer, not a shortcut.
  path: "/",
  // Matches the 7-day absolute session lifetime in
  // circle-member-session.service.ts. If that lifetime ever changes, this
  // must change with it.
  maxAge: 7 * 24 * 60 * 60,
} as const;
