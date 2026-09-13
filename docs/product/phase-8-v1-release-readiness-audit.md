# NIA V1 release-readiness audit (8A)

Status: audit only. No runtime behavior, schema, migration, test, or data changed.

## Executive result

**READY FOR HARDENING, not ready to invite real users yet.** Core domain
invariants, authorization, current migration state, lint, Prisma validation,
and the Next production build are credible. No P0 issue was found. Before
launch, prove the member-auth ingress boundary on real Vercel, run a human
browser smoke against a migrated preview-like deployment, and clean the
test-only TypeScript baseline.

| Severity | Finding | Required action |
| --- | --- | --- |
| P0 | None found. | — |
| P1 | Source review cannot prove Vercel prevents client spoofing of the trusted member-login source header. | Run Preview ingress/spoofing verification. |
| P1 | Critical journeys have no recorded deployed authenticated browser smoke. | Run the checklist below. |
| P1 | Standalone `tsc` reports nine test-only errors. | Fix test typing/config before clean CI sign-off. |
| P2 | Rate-limit integration test shares configured DB/GLOBAL bucket. | Require isolated `TEST_DATABASE_URL` in CI. |
| P2 | No explicit security-header policy or route error/loading boundaries. | Add minimum resilience hardening. |
| P2 | Observability is console/Vercel logs only; recovery settings are unknown. | Establish log/alert ownership and verify Neon recovery. |
| P3 | No PWA assets or installability. | Ship responsive web; defer PWA. |
| DEFERRED | SUSU archive. | Phase 8 desirable, not a blocker. |

## Platform auth and authorization

Registration validates input, hashes passwords with bcrypt cost 12, and safely
handles the unique-email race. Credentials login uses a dummy bcrypt hash for
unknown/malformed identities, Auth.js JWT sessions, and `getVerifiedUser()`
re-reads the `User` row: deleted users lose access despite a stale token.
`requireUser()` in the app layout is authoritative; `proxy.ts` is only an
optimistic guard. Owner services/actions derive the actor from trusted session
context and independently scope/re-check ownership.

`AUTH_SECRET` must be a strong production secret. Auth.js manages its secure
production cookies. Password reset, email verification, MFA, and OAuth are
not blockers for this direct V1 usage model. Fixed redirects prevent an open
redirect path.

## Member auth, ingress, and rate limiting

Member login establishes trusted request source before limiting or PIN work,
uses SOURCE/TARGET/GLOBAL durable PostgreSQL buckets, performs dummy bcrypt
comparison on failures, and issues a hashed opaque session only after verified
credentials. Member sessions are seven-day absolute, `HttpOnly`, `SameSite`
`Lax`, and `Secure` in production; validation rechecks expiry, revocation,
active membership, circle status, and credential version. Five bad PINs lock
the member for 15 minutes. Only persisted `PayoutRound.recipientId` can
confirm/dispute a payout.

`MEMBER_AUTH_RATE_LIMIT_SECRET` is HMAC-only, distinct from `AUTH_SECRET`,
and fails closed when absent/weak. The source contract relies on Vercel's
`x-vercel-forwarded-for` with no proxy/CDN in front. Before launch, on a real
Vercel Preview, verify: normal header is a single valid edge value; a
client-supplied spoof cannot choose the limiter source; missing/malformed
source returns generic failure with no session; and `ALLOW_TEST_AUTH_SOURCE`
is absent in Preview/Production. Local tests cannot prove this edge behavior.

The known intermittent limiter test is **test-infrastructure risk**, not a
runtime safety finding. Runtime GLOBAL state is deliberately shared. The test
uses the configured database and fixed GLOBAL key/window, so concurrent tests
or login traffic can perturb expected counts. A dedicated `TEST_DATABASE_URL`
is required for deterministic CI, not for production limiter correctness.

## TypeScript baseline

`npx tsc --noEmit` reports nine errors:

| File | Error type | Runtime relevance | Severity |
| --- | --- | --- | --- |
| `src/auth/trusted-member-auth-source.test.ts` | One `.ts` import-path configuration error and seven writes/deletes to read-only `process.env.NODE_ENV` typings. | Test-only, excluded from the app bundle. | P1 CI baseline. |
| `src/services/circle-member-auth-rate-limit.service.test.ts` | One write to read-only `process.env.NODE_ENV` typing. | Test-only, excluded from the app bundle. | P1 CI baseline. |

Next's production build, including its TypeScript stage, passes. These errors
should still be fixed before release CI is described as deterministic.

## Environment matrix

| Variable | Scope | Secret | Production requirement | Missing behavior |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Runtime server Prisma adapter | Yes | Required | Prisma connection/query failure. |
| `DIRECT_URL` | Prisma CLI migrations/status | Yes | Direct Neon endpoint strongly required | Falls back to pooled URL, which may be unsuitable for migrations. |
| `AUTH_SECRET` | Auth.js server signing | Yes | Required | Auth configuration unsafe/fails. |
| `MEMBER_AUTH_RATE_LIMIT_SECRET` | Member login server limiter | Yes | Required, distinct, ≥32 chars | Login fails closed before PIN/session. |
| `TEST_DATABASE_URL` | Isolated cleanup/integration tests only | Yes | Not runtime-required | Tests cannot be safely isolated. |
| `ALLOW_TEST_AUTH_SOURCE` | Local/test override only | No | Must be absent | Local member login fails closed if absent; production override remains blocked by `NODE_ENV=production`. |

`.env.example` documents these values. No email, Resend, external API,
deployment-origin, client-exposed runtime, or PWA variable is used by core
flows.

## Database and data safety

Prisma CLI uses direct URL (with documented fallback); runtime uses the Pg
adapter and `DATABASE_URL`. The configured Neon database reports ten applied
migrations and is up to date. An empty database can migrate from zero along
the committed history; early transition migrations intentionally drop obsolete
pre-V1 structures after the initial migration creates them. An un-audited
legacy database with old architecture data must not be treated as equivalent.
An existing current database can upgrade safely through the audited sequence.

Release procedure: confirm branch/backup, use `pnpm prisma migrate deploy`
with direct connection, run `pnpm prisma migrate status`, then execute smoke.
No migration is pending. Financial historical FKs are restrictive; normal
paths do not delete records, cascade financial history, reopen terminal states,
overwrite decision provenance, or return password/PIN/session hashes.

## Browser evidence and required smoke

| Journey | Existing evidence | Required browser check |
| --- | --- | --- |
| Platform registration/login/logout/protected redirect | Actions/source/DOM | Register, login, logout, direct protected URL redirect. |
| Personal goal/deposit/custodian/complete/archive | Services/actions/live PostgreSQL | Full owner path and one custodian decision. |
| SUSU owner draft through completion/history | Services/actions/live PostgreSQL/concurrency/UI | Full flow with distinct owner/members. |
| SUSU member login/dashboard/confirm/dispute/completed read | Auth/session/services/actions/DOM | Login and recipient-only confirmation/dispute in separate fixtures. |

Manual release checklist: (1) register owner, logout/login, confirm protected
deep-link redirect; (2) create a goal, deposit, custodian flow, completion and
archive; (3) draft/add/remove/order/activate/start a circle; (4) record and
confirm/reject contributions, record exact external payout, and let only its
recipient confirm or dispute; (5) advance all ready rounds, complete, and
return through `/circles` to historical workspace; (6) verify member sees
only own dashboard and completed history; (7) repeat key forms/navigation at
320–390px and desktop; (8) run Vercel ingress checks and inspect logs for
generic client errors with no raw credential/source/token leakage.

## UI, navigation, PWA, observability

Navigation includes Dashboard, My savings, Trusted person, and `/circles`.
The owner circle index lists DRAFT, ACTIVE, and COMPLETED circles, so no URL
must be preserved to return to an essential resource. Completed history stays
readable. Missing `COMPLETED → ARCHIVED` is therefore Phase 8 desirable, not
a release blocker.

Source review finds responsive layouts and mobile navigation, but not physical
device evidence. No `manifest`, service worker, install icons, standalone
metadata, or offline claim exists: NIA can launch as responsive web; PWA is
P3. No route-level `error.tsx`/`loading.tsx` files were found. Expected action
errors are generally mapped safely, but unexpected render/database failures
need P2 graceful presentation.

Logs are sanitized `console.error` plus hosting logs, without a monitoring
service. Before public rollout, enable retained Vercel logs, designate alert/
triage ownership, document mutation/auth diagnosis, and verify Neon backup or
point-in-time-recovery ownership in dashboards. Those dashboard settings
cannot be proven from this repository.

## Test evidence and Phase 8 plan

Phase 7 boundary evidence: 1407 total, 1399 passed, 7 skipped, one known
intermittent unrelated limiter integration failure. Coverage includes unit,
dependency-injected behavior, structural/source guards, live PostgreSQL,
concurrency, and DOM tests. It lacks real-Vercel ingress evidence and deployed
authenticated browser smoke. The full suite was intentionally not rerun.

1. **8B: production environment and ingress verification** — Vercel Preview,
   secret/migration confirmation, and spoof/missing-header proof.
2. **8C: TypeScript + isolated limiter CI** — remove nine test errors and
   require a dedicated test database.
3. **8D: critical browser/mobile smoke** — run checklist and fix only defects
   found.
4. **8E: resilience baseline** — minimal security headers, error presentation,
   log/alert ownership, and recovery runbook.
5. **8F: release-candidate audit** — rerun all gates against the target build.

Archive, PWA/offline, password reset, email verification, MFA, OAuth, and
notifications remain outside the minimal launch sequence.

## 8B — Vercel ingress verification

Status: **BLOCKED — no real Vercel Preview target is connected to this
workspace.** At the time of this verification there was no `.vercel` project
link, no available Vercel CLI, and no supplied Preview deployment URL or
Vercel environment/log access. Consequently, this repository cannot prove the
edge-owned behavior of `x-vercel-forwarded-for`, Preview-scoped secret
presence, cookie delivery over Preview HTTPS, or Preview database identity.
Localhost and source review are explicitly insufficient for those claims.

| Contract assumption | Observed Preview behavior | Match? | Release implication |
| --- | --- | --- | --- |
| Single trusted `x-vercel-forwarded-for` | Not observable: no Preview deployment. | Unverified | P1 gate remains blocked. |
| Client cannot choose trusted source | Not observable: no Vercel edge request path. | Unverified | Do not launch member auth until spoof tests pass. |
| Missing/malformed parser fails closed | Source and focused-test evidence only. | Structurally yes | Still requires real-edge validation. |
| Test override absent | Preview environment unavailable. | Unverified | Must verify `ALLOW_TEST_AUTH_SOURCE` absent. |
| Secure member cookie | Source contract only (`HttpOnly`, `Secure` in production, `SameSite=Lax`, `/`, seven days). | Structurally yes | Inspect deployed Set-Cookie before launch. |
| Required secrets | Preview environment unavailable. | Unverified | Verify presence, distinctness, and limiter-secret length without exposing values. |
| Session issued after verified credentials | Source/action/service evidence only. | Structurally yes | Confirm via deployed valid login. |

### Available local evidence

- `pnpm lint`, `pnpm build`, and `pnpm prisma validate` passed.
- `pnpm prisma migrate status` against the currently configured Neon database
  reported ten migrations and schema up to date. This is **not** evidence that
  a future Preview uses a safe, separate Neon branch.
- The source parser accepts only one syntactically valid IPv4/IPv6 value,
  rejects comma-separated lists/malformed values, and allows the local test
  override only when `NODE_ENV !== "production"` and
  `ALLOW_TEST_AUTH_SOURCE=1`.
- A test command forced to Node 20 failed before running because Node 20 does
  not accept `--experimental-strip-types`. Re-running `pnpm test` under the
  default Node 22 did run the package's full globbed suite rather than the
  intended selected files; the script does not support focused file selection
  by simple appended paths. Treat the resulting output as broader local
  evidence, not a scoped 8B test result.

### Required unblock inputs and procedure

Provide or connect a Vercel Preview deployment and its safe Preview Neon
database. Then verify environment presence (not values), use `DIRECT_URL` for
`pnpm prisma migrate status` and any required `pnpm prisma migrate deploy`,
create temporary preview-only owner/member fixtures, and run valid login,
spoofed IPv4/IPv6/comma-chain requests, a small invalid-login sequence, cookie
inspection, platform login/logout, and sanitized log inspection. Stop and
escalate as a security blocker if the app receives an attacker-chosen
`x-vercel-forwarded-for` value.

## 8C — TypeScript and limiter CI hardening

The standalone baseline was exactly nine errors: one test-only relative
`.ts` import-path error, seven direct `process.env.NODE_ENV` mutations in the
trusted-source test, and one direct `NODE_ENV` mutation in the limiter test.
The import is now extensionless, as the repository test loader already probes
TypeScript extensions. The trusted-source test uses a narrow descriptor-based
environment helper and restores the original descriptor after every case;
test intent for unset, test, and production `NODE_ENV` states is unchanged.

`src/services/circle-member-auth-rate-limit.service.test.ts` now checks
`TEST_DATABASE_URL` before importing the runtime Prisma client. Only when the
existing hostname-based guard confirms a distinct database does the test
process point its Prisma imports at that isolated database. Without it, all
database/global-state integration cases skip with the guard's explicit reason;
the static privacy and dependency-boundary tests still run. The ordinary
`DATABASE_URL` is never silently treated as isolated, including when copied
verbatim into `TEST_DATABASE_URL`.

The focused command is intentionally direct, not `pnpm test <files>`:

```sh
node --experimental-strip-types --conditions=react-server \
  --import ./scripts/test-register-path-alias-loader.mjs --test \
  src/auth/trusted-member-auth-source.test.ts \
  src/services/circle-member-auth-rate-limit.service.test.ts
```

Under the available Node 22.23.2 runtime, it passed 17 tests and skipped 17
isolation-dependent limiter tests because no isolated `TEST_DATABASE_URL` is
configured. The known shared-GLOBAL flake is therefore removed from normal
non-isolated local/CI execution; it remains testable deterministically once a
real isolated database is supplied. `npx tsc --noEmit` now passes with zero
errors. `package.json` declares Node `>=22.0.0`, because Node 20 cannot run
the repository's required `--experimental-strip-types` test command.

No production runtime behavior changed: trusted source parsing, limiter
thresholds, PIN lockout, credential verification, member sessions, cookies,
and production database selection retain their existing contracts. Ticket 8B
remains blocked on an actual Vercel Preview. For 8D: member authentication is
available at `/member/login`, but discoverability must be checked from normal
`/login`, public/global navigation where appropriate, and the owner member
credential handoff.

## 8D — critical browser, mobile, and authentication journey hardening

Status: **PARTIALLY VERIFIED LOCALLY; deployed authenticated smoke remains
blocked.** The platform login screen now clearly directs SUSU members to the
separate `/member/login` route, explicitly distinguishing NIA account
email/password credentials from the Circle ID, member code, and PIN. The
one-time owner handoff now names those three member credentials and links to
the member-login path.

Local browser evidence against the current development server:

- `/login` displays the member sign-in explanation and an accessible
  “Sign in as a SUSU member” link; it navigates to `/member/login`.
- `/member/login` displays the Circle ID, member code, and PIN fields.
- At 375px, 390px, and 430px widths, `/login` had no horizontal overflow and
  the member-login link remained visible; `/member/login` also had no
  horizontal overflow and kept all three credential inputs visible.
- Unauthenticated `/dashboard`, `/goals/new`, `/custodian`, and `/deposits`
  redirected to `/login`; `/`, `/login`, and `/register` remained public.

The full owner and member financial journeys were intentionally not run
against the configured shared Neon database: doing so would require creating
and exercising real authenticated/financial fixture data. They still require
a safe isolated Preview-like database and a real Vercel Preview. That Preview
is also necessary to close 8B's ingress, secure-cookie, and trusted-source
checks. No production or shared-database rows were created by 8D.

## 8E — resilience baseline

The app now has a generic root not-found page, a global unexpected-error
boundary, a shared authenticated-app error boundary, and a separate member
error boundary that returns members only to `/member/login`. These boundaries
present calm recovery actions without rendering error messages, stacks, Prisma
details, database identifiers, or secrets. Targeted loading states cover the
platform dashboard, Personal Goal routes, owner circle workspace, and member
circle dashboard.

The current owner resource readers already collapse missing and unauthorized
resources to the same `notFound()` outcome; the new root presentation preserves
that privacy behavior rather than distinguishing existence from ownership.
Authenticated platform pages call `requireUser()` and member pages call
`requireCircleMember()`, both of which use request-bound authentication state;
there is no concrete public-cache finding or cache-policy rewrite needed.

An explicit response-header baseline now sets `X-Content-Type-Options`, a
strict-origin referrer policy, restrictive camera/geolocation/microphone/payment
permissions, `X-Frame-Options: DENY`, and one-year HSTS. CSP is deliberately
deferred: a restrictive policy has not been tested against the current Next
runtime, Auth.js, Vercel, and Google-hosted fonts, so shipping one would create
unnecessary release risk.

The logging review found current `console.error` calls log fixed operation
labels plus `Error.name`, not submitted credentials, tokens, headers, URLs, or
financial payloads. Existing action tests show unexpected service failures are
mapped to generic client messages; expected domain/validation errors remain
useful. No concrete logging sanitization change was required.

`docs/operations/v1-operations-runbook.md` now records deployment, auth,
database, financial-history, Neon recovery, and Vercel log/triage procedures.
Neon backup/PITR and Vercel retained-log/alert configuration remain unverified
until their dashboards are accessible. The P1 8B Preview-ingress proof and
the 8D authenticated Preview/browser smoke remain blocked; no P0 issue was
introduced or resolved by this ticket.
