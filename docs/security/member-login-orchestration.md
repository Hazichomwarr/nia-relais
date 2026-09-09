# SUSU Member Login Orchestration (7G.4)

Status: implemented. This is the ticket that connects the previously
independent, independently-tested primitives — trusted source (7G.2.4), rate
limiter (7G.2.5/7G.2.6), credential verifier (7G.1/7G.2), and member session
issuance (7G.3) — into one public login endpoint. No member login UI, member
dashboard, contribution/payout mutation, PIN rotation, or notification flow
exists as of this ticket.

## Route namespace

- Login API: `POST /api/member/auth/login` (`app/api/member/auth/login/route.ts`).
- Reserved for future tickets, not built here: member-facing pages under
  `/member/...` (e.g. `/member/login`, `/member/circles/[circleId]`).

This endpoint is deliberately isolated from `/api/auth/[...nextauth]`
(platform User auth) — different route, different handler file, no shared
code path beyond framework-level `Response`/`cookies()` primitives.

## Cookie Path decision

`CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS.path` is `"/"`, not a narrower prefix.
The login API lives under `/api/member/...` and the future member pages will
live under `/member/...` — two prefixes with no shared ancestor narrower than
`/` that covers both. Scoping to `/api/member` would make the cookie
invisible to the member pages that must send it on every request; scoping to
`/member` would make it invisible to the very endpoint that sets it. `/` is
the honest answer given this topology, not a default left unexamined — see
`src/auth/circle-member-session-cookie.ts`.

## Input contract

The route accepts exactly three fields in the JSON body: `circleId`,
`memberCode`, `pin`. Nothing else is read from the request — no `userId`,
`memberId`, `credentialVersion`, membership status, circle status, or session
identity field exists in the request schema, so there is nothing for the
server to (correctly) ignore; a client cannot even attempt to smuggle those
in a way the code notices.

Two layers of validation exist, deliberately different in strictness:

1. `circle-member-login.service.ts`'s own bounded schema (max length + type
   only, with `.catch("")` on every field so parsing never throws) — just
   enough to safely reach the rate limiter, which needs `circleId` and
   `memberCode` even when they are malformed (a malformed pair still
   consumes bounded `TARGET`-scope capacity via the limiter's own
   `malformed-target` sentinel, rather than bypassing the limiter).
2. `verifyCircleMemberCredentialsSchema`'s strict shape check (CUID pattern,
   16-hex member code, 6-digit PIN), enforced inside
   `verifyCircleMemberCredentials` itself, which this route never
   re-implements or duplicates.

## Execution order

Enforced by `loginCircleMember` (`src/services/circle-member-login.service.ts`),
called from the route handler:

```
getTrustedMemberAuthSource(request)
        |  ok:false -> stop, generic failure. Rate limiter and verifier never run.
        v
checkMemberAuthenticationRateLimit({ source, circleId, memberCode })
        |  allowed:false -> stop, generic failure. Verifier never runs.
        v
verifyCircleMemberCredentials({ circleId, memberCode, pin })
        |  throws CircleMemberAuthenticationError -> stop, generic failure. No session issued.
        v
createCircleMemberSession({ circleId, memberId, credentialVersion })
        (using ONLY the verifier's own returned circleId/memberId/credentialVersion --
         never the raw client-supplied circleId/memberCode/pin again)
        |  throws -> stop, generic failure, no cookie set, no retry.
        v
cookies().set(nia_member_session, rawToken, CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS)
        v
{ ok: true } JSON response (never contains the token)
```

Each arrow's failure path returns the identical `{ ok: false }` from
`loginCircleMember`, which the route handler turns into one generic
`401 { ok: false, error: "Invalid credentials." }` response — the caller
cannot distinguish which step failed from the response alone.

## Rate limiter secret

`MEMBER_AUTH_RATE_LIMIT_SECRET` is required by
`checkMemberAuthenticationRateLimit` itself (7G.2.5); this orchestration
layer adds no separate check and no bypass for local development or preview
deployments — an absent or too-short secret makes the limiter return
`{ allowed: false }`, which this route treats exactly like an exceeded limit
(generic failure, verifier never called). The test-source override
(`x-nia-test-source`) remains gated by its own two-condition guard in
`trusted-member-auth-source.ts` (`ALLOW_TEST_AUTH_SOURCE=1` AND
`NODE_ENV !== "production"`) and is not touched by this ticket.

## Failure behavior and non-leakage

`GENERIC_FAILURE_BODY` (`{ ok: false, error: "Invalid credentials." }`,
HTTP 401) is the only failure shape this route ever returns, regardless of
whether: the trusted source could not be established, either rate-limit
scope was exceeded, the circle or member code doesn't exist, the PIN is
wrong, the member is locked or removed, or the circle is `DRAFT`. Session
issuance failure after successful credential verification also produces this
exact response — no cookie is set, no retry of credential verification
occurs, and no second session is created merely because the response could
not be delivered (the login attempt simply ends; a new HTTP request is the
only way to try again).

No raw IP, member code, PIN, session token, or secret is logged by this
route or by `loginCircleMember` — the only logging on this path already
existed inside the rate limiter and session services themselves (7G.2.5,
7G.3), which log only error class names on unexpected internal failures.

## Platform User isolation

This route imports nothing from `next-auth`, `@/auth`, or any platform-user
session code. It reads and writes exactly one cookie
(`nia_member_session`); it never reads, writes, or references the Auth.js
cookie. A platform User session and a SUSU member session are unrelated
values that happen to be able to coexist in the same browser.
