# SUSU Member Session Contract

Status: session issuance/validation/revocation implemented (7G.3). The public
login route now exists (7G.4, `POST /api/member/auth/login`) and is
documented in `docs/security/member-login-orchestration.md` — this document
describes the session primitive itself; the orchestration doc describes how
it is called. No member dashboard, PIN rotation, or notification flow exists
yet.

## Identity contract

A member session represents exactly `(circleId, memberId, credentialVersion)`.
It never represents, derives from, or is derivable into a platform `User.id`.
Platform-user authentication (Auth.js, `src/auth/require-user.ts`) and SUSU
member authentication (`src/services/circle-member-session.service.ts`) are
two entirely separate identity systems that share no code, no cookie name,
and no session store. `CircleMemberSession` rows are looked up only by
`tokenHash`; nothing in this system ever reads or writes an Auth.js JWT or
`session.user.id`.

## Fresh authorization

A valid, unexpired, unrevoked session proves only "this browser once
authenticated as member X." It does not permanently prove "member X is still
authorized." Every call to `validateCircleMemberSession` re-reads the
member's current `status` and `credentialVersion`, and the circle's current
`status`, from the database — never from anything cached on the session row
itself beyond the `credentialVersion` snapshot taken at issuance (compared
against, not trusted in place of, the live value). A member removed after
their session was issued is denied on the very next validation, even though
the session token itself is technically still unexpired and unrevoked.

## lastUsedAt decision

**Chosen: Option A — `lastUsedAt` is left unchanged by `validateCircleMemberSession`
for all of V1.** It is never written by issuance either (only `createdAt` is
set there). This is the simpler of the two options the ticket allowed, and
avoids turning every authenticated request into a write against the
sessions table purely to update a timestamp nobody reads yet. The column
stays nullable and unused in this ticket; a future ticket may adopt Option B
(update only when sufficiently stale, e.g. once per hour) if and when an
actual feature needs to know it (an "active sessions" view, idle-timeout
policy, etc.) — there is no reason to build that write path before something
consumes the value.

## Token handling

- Raw token: `crypto.randomBytes(32)`, base64url-encoded. Returned exactly
  once, by `createCircleMemberSession`, for the caller to set as a cookie
  value.
- Persisted: `SHA-256(rawToken)`, hex-encoded, as `tokenHash`. The raw token
  is never written to PostgreSQL, under any column, and never logged.
- Lookup is always by `tokenHash` (`@unique` in the schema) — an attacker
  who obtains a `tokenHash` value (e.g. from a database leak) cannot recover
  the original token needed to actually present as a valid session cookie,
  since SHA-256 is one-way.

## Session lifetime

Fixed 7-day absolute lifetime, computed at issuance as `now + 7 days` using
the application's own clock (not PostgreSQL's). This is a deliberate
proportionality choice, not an oversight: unlike the auth rate limiter's
1–15 minute windows (where sub-minute clock skew between an app server and
the database is materially significant), a few seconds of drift is
negligible against a 7-day window. No sliding/refresh behavior exists in
V1 — a session is either within its original 7-day window or it is not;
renewing that window is left to a future ticket.

## Failure behavior

`validateCircleMemberSession` returns `{ valid: false }` uniformly for every
failure cause — unknown token, revoked, expired, removed member,
credentialVersion mismatch, or an ineligible circle state are all
indistinguishable to the caller. No raw token, member code, PIN, or
credential material is ever logged; an unexpected internal error is logged
only by its error class name and otherwise treated identically to any other
invalid session (fail closed, not fail open).

## Revocation

Two primitives, both mark rows `revokedAt = <timestamp>` — **never** a hard
delete, so revoked sessions remain historical rows:

- `revokeCircleMemberSessionByToken(rawToken)` — revokes exactly the one
  session matching that token. This is the shape a future logout action will
  actually have (the cookie value), not an internal session id it was never
  given.
- `revokeAllCircleMemberSessions({ circleId, memberId })` — revokes every
  currently-active session for that member at once, using already-trusted
  membership identity (not a token) — the primitive a future PIN-rotation or
  member-removal ticket will call.

Nothing restricts a member to one session at a time: no unique constraint
ties `CircleMemberSession` to "one row per member," so multiple concurrently
valid sessions (e.g. two different browsers) are supported by default.

## Circle lifecycle eligibility

Session issuance and every subsequent validation both check the circle's
**current** status against the same allowlist: `ACTIVE`, `COMPLETED`,
`ARCHIVED`. `DRAFT` (nothing to authenticate into yet) and `CANCELLED`
(terminated) are excluded by omission from the allowlist, not by an explicit
denylist check — a future `CircleStatus` value defaults to ineligible unless
someone deliberately adds it here.

## Cookie contract (defined, not wired up)

See `src/auth/circle-member-session-cookie.ts`:

- Name: `nia_member_session` — distinct from Auth.js's own cookie.
- `httpOnly: true`, `secure` in production only (off in dev so it still
  works over plain `http://localhost`), `sameSite: "lax"`.
- Value: the opaque raw token only — never circleId, memberId, or any other
  identity material.
- Path is `/` — see `docs/security/member-login-orchestration.md`
  ("Cookie Path decision") for why a narrower prefix doesn't work given the
  disjoint `/api/member/...` and `/member/...` namespaces.

## Security boundary — wired in 7G.4

This service is now connected to a public login route. See
`docs/security/member-login-orchestration.md` for the full orchestration
(`src/services/circle-member-login.service.ts`,
`app/api/member/auth/login/route.ts`):

```
trusted request source (7G.2.4)
        ↓
rate limiter (7G.2.5 / 7G.2.6)
        ↓
verify member code + PIN (existing credential verifier)
        ↓
createCircleMemberSession (this ticket, 7G.3)
        ↓
set secure member cookie (cookie contract above, wired in 7G.4)
```

No member login UI, member dashboard, contribution/payout mutation, or PIN
rotation exists as of 7G.4.
