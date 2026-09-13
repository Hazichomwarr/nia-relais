# NIA V1 operations runbook

Use this runbook for production operation and incident triage. It does not
replace an incident process, and it does not authorize ad-hoc data edits.

## Deployment

- Use Node.js 22 or later (`package.json` declares `>=22.0.0`).
- Install dependencies with `pnpm install`, then run `pnpm build`.
- Confirm production environment variables exist without printing values:
  `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, and
  `MEMBER_AUTH_RATE_LIMIT_SECRET`. `ALLOW_TEST_AUTH_SOURCE` must be absent.
- Use the direct database connection for `pnpm prisma migrate deploy`, then
  run `pnpm prisma migrate status` and confirm the schema is up to date.
- After deployment, smoke public pages, platform login/logout and a protected
  redirect, then run the approved Preview-only member-auth checks before
  inviting users.

## Authentication incidents

### Platform login failure

Check Vercel server logs for the affected time and route, verify the Auth.js
secret is present (not its value), and confirm the database is reachable. Do
not copy passwords, session cookies, request headers, or connection strings
into tickets or chat.

### SUSU member login failure

Check Vercel logs for the member-login route and confirm the rate-limit secret
is present, distinct from `AUTH_SECRET`, and meets the documented length
requirement. Check the trusted ingress configuration and rate-limit cleanup
health. Treat member credentials, PINs, member codes, source addresses, and
session tokens as sensitive; do not log or request them in incident notes.

### Member rate-limit issue

Confirm whether the issue is a true limiter denial, a trusted-source failure,
or a database failure. The member login response is intentionally generic, so
use protected server logs and metrics rather than changing the client response
to diagnose it. Do not delete buckets to bypass a limit without a documented
incident decision.

## Database incidents

### Migration failure

Stop deployment. Capture the migration name and sanitized Prisma/Vercel error
class, run `pnpm prisma migrate status` with the direct connection, and compare
against the committed migration history. Do not use `db push`, reset, or force
commands as an incident shortcut.

### Neon unavailable or unexpected query failures

Check Neon project/branch availability, connection health, and Vercel logs.
Record only sanitized error types and timestamps. Escalate to the database
owner if availability does not recover; do not expose URLs, credentials, raw
SQL, or production data in incident communications.

## Financial mutation reports

When a user reports that a contribution disappeared, a payout is wrong, or a
goal total is wrong, **do not manually mutate production financial records**
until provenance and history are understood. First inspect the persisted
history, lifecycle status, idempotency/operation identifiers, and recorded
actor provenance using approved read-only access. Preserve the existing record
trail and escalate before any corrective action.

## Recovery readiness

Neon backup and point-in-time recovery cannot be verified from this repository.
Before inviting production users:

1. Identify the production Neon project and branch.
2. Verify backup/PITR availability and its retention window in Neon.
3. Identify who can perform a restore.
4. Document the internal restore procedure and link.
5. Schedule a restore drill when practical.

Do not claim any of these items are complete until they have been checked in
the Neon dashboard.

## Logs, alerting, and triage

Vercel logs are the expected first source for deployment, request, auth, and
server-error investigation. Before launch, verify that retained logs are
available, authentication failures and server errors can be searched without
exposing secrets, an incident-triage owner role is assigned, and the escalation
path is documented. These are external deployment checks, not repository
evidence.
