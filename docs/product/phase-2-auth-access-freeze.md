# Phase 2 Auth & Access Freeze

## Purpose

Phase 2 establishes the platform-user account and access foundation for
NiaRelais before Personal Savings Goal work begins.

## Platform authentication model

NiaRelais uses Auth.js v5 Credentials authentication with email and password,
JWT sessions, and no Auth.js adapter. Password verification is centralized in
the Credentials provider's `authorize()` callback using `bcryptjs`.

The identity invariant is:

```text
Auth.js session.user.id == User.id
```

`CircleMember` identity is not represented by Auth.js and SUSU member access
will use a separate future mechanism.

## Authentication flows

Registration follows:

```text
FormData → Zod validation → registration service → repository
→ bcrypt hash → User row → Auth.js signIn("credentials") → /dashboard
```

Login follows:

```text
FormData → Zod validation → Auth.js signIn("credentials")
→ authorize() → /dashboard
```

Logout uses Auth.js `signOut()` and redirects to `/`. No custom cookies or
JWTs are created.

## Verified platform-user access

`auth()` proves that an Auth.js session is cryptographically valid. It does not
prove that the platform User still exists.

`getVerifiedUser()` calls `auth()`, reads `session.user.id`, verifies the User
row through Prisma, and returns only `{ id, name }` or `null`. It is server-only
and never redirects.

`requireUser()` delegates to `getVerifiedUser()` and redirects to `/login`
when no verified platform User exists. It is the actual server-side security
boundary for the protected application shell.

This prevents stale JWTs from causing a redirect loop:

```text
valid JWT + missing User → /dashboard → /login
valid JWT + missing User → /login renders normally
```

## Proxy boundary

Next.js 16 `proxy.ts` is an optimistic gate. Its matcher is intentionally
narrow:

```text
/dashboard/:path*
```

It checks only the Auth.js session shape and redirects unauthenticated
requests to `/login`. It does not query Prisma and is not the security
boundary. The protected `(app)` layout still calls `requireUser()`.

## Authentication vs authorization

Phase 2 answers only whether a valid platform User exists. It does not answer
whether a User owns a goal or circle, is a custodian, or is a linked
CircleMember. Aggregate authorization is deferred to feature work.

## Future SUSU member-auth boundary

SUSU members remain circle-scoped identities. Future member-code and PIN-based
access must not overload `session.user.id`, which remains reserved for
platform `User.id`.

## Deferred features

The following remain outside the freeze:

- PersonalGoal, Deposit, and SavingsCircle authorization
- GoalCustodian behavior and invitations
- SUSU/CircleMember authentication
- Protected application business navigation and dashboard data
- Password reset and email verification
- OAuth
- Account deletion/anonymization

## Verification evidence

- `pnpm lint`: passed
- `pnpm build`: passed
- `pnpm prisma validate`: passed
- `pnpm prisma migrate status`: schema up to date; no pending migrations
- `git diff --check`: passed
- Unauthenticated `/dashboard`: redirects to `/login`
- Unauthenticated `/login`: returns `200`
- Unauthenticated `/register`: returns `200`

No durable test data was created. No test runner is configured in the
repository, so authenticated behavior was verified structurally rather than
with fabricated accounts.

## Freeze statement

PHASE 2 — ACCOUNT & ACCESS FOUNDATION: FROZEN
