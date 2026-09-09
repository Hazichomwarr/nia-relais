# CircleMemberAuthRateLimitBucket Retention & Cleanup

Status: cleanup mechanism implemented (7G.2.6); scheduling is a documented,
deliberately-deferred proposal, not yet wired up (see "Scheduling" below).

## Retention contract

- A bucket row is **eligible for deletion** once `expiresAt < now()`
  (PostgreSQL's own clock), i.e. once its fixed window has fully ended.
- A row still inside its active window (`expiresAt >= now()`) **must never**
  be deleted, by anyone, for any reason — doing so would silently reset an
  attacker's (or a legitimate user's) counter mid-window. The cleanup
  repository's `WHERE "expiresAt" < now()` clause makes this true by
  construction, not by convention.
- Cleanup **does not alter authentication decisions**: it only ever removes
  rows for windows that have already closed, so it cannot change whether any
  past or currently-open admission check was, or will be, allowed or denied.
- Cleanup **does not touch domain or session tables**: `DELETE` targets only
  `CircleMemberAuthRateLimitBucket`; `User`, `PersonalGoal`, `Deposit`,
  `GoalCustodian`, `SavingsCircle`, `CircleMember`, `CircleMemberSession`,
  and every other table are never referenced by the cleanup repository or
  service. Verified structurally and (once an isolated test database exists)
  by a live before/after count comparison.
- **Logical expiry alone does not bound physical storage.** `expiresAt`
  being in the past does not cause PostgreSQL to remove a row on its own —
  nothing happens until an explicit `DELETE` runs. Without a scheduled
  cleanup actually executing, the table grows monotonically forever, exactly
  as flagged (and left unbuilt) in 7G.2.5. This ticket builds the deletion
  mechanism; it does not yet schedule it (see below).

## Correction: actual cardinality and retention behavior

7G.2.5's service comments claimed a denied attempt "increments an existing
bucket, it never creates a new key." **That claim is incomplete and is
corrected here.**

It is accurate for **SOURCE** and **GLOBAL**: each has exactly one row per
party (one IP, or the single fixed app-wide key) per elapsed window, and
that row already exists the moment *any* attempt occurs — a denied attempt
from an already-tracked source does not create an additional SOURCE row, and
GLOBAL is a single shared key regardless of outcome.

It is **not accurate for TARGET**. `checkMemberAuthenticationRateLimit`
always increments all three scopes before evaluating admission, regardless
of whether SOURCE or GLOBAL already denied the request. This means an
attacker already blocked by SOURCE (past 20 attempts in 15 minutes) can
still cause a **brand-new TARGET row** on every subsequent — still denied —
request, simply by submitting a different `circleId`/`memberCode` pair each
time. Being denied by SOURCE does not stop the TARGET increment from
happening, and therefore does not stop a new TARGET bucket from being
created for a pair never seen before.

Malformed targets remain the one bounded exception: any pair that fails the
CUID/16-hex-code shape check collapses to a single shared sentinel row
(`TARGET:malformed-target`), regardless of how many distinct garbage inputs
are tried. But a *syntactically valid* pair that simply doesn't correspond
to a real member is **not** deduplicated beyond the pair itself.

**Actual cardinality, per scope:**

| Scope | Rows per elapsed window | Growth driver |
|---|---|---|
| GLOBAL | exactly 1 | none (fixed key) — effectively bounded already |
| SOURCE | ≤ 1 per distinct source IP that has attempted authentication | number of distinct attacking/legitimate IPs, not request volume from any one IP |
| TARGET | ≤ 1 per distinct syntactically-valid `(circleId, memberCode)` pair attempted, **plus** exactly 1 shared malformed-input row | number of distinct pairs tried — **not bounded by SOURCE's own threshold**, since a SOURCE-denied request still creates/increments its TARGET row |

**TARGET is the dimension most exposed to genuine unbounded row growth** from
a determined attacker spraying distinct fake-but-valid-shaped target pairs
from one source — this is precisely why bounded, regularly-scheduled
cleanup is necessary rather than optional, and why this ticket exists.

## Cleanup API

`cleanupExpiredMemberAuthRateLimitBuckets({ batchSize?: number })` in
`src/services/circle-member-auth-rate-limit-cleanup.service.ts`:

- Deletes **one bounded batch** (default 500, max 1000, min 1 — clamped, not
  rejected, if a caller passes something outside that range) of the
  oldest-expired rows, selected deterministically
  (`ORDER BY "expiresAt" ASC, id ASC`), per invocation.
- A single invocation never attempts an unbounded `DELETE`; it never scans
  or locks more than `batchSize` candidate rows.
- A scheduler invoking this repeatedly (see "Scheduling") drains a larger
  backlog gradually, rather than any one call doing unbounded work.
- Returns only `{ ok: true, deletedCount }` or `{ ok: false }` — never a row
  list, key, scope, or any source/credential material.
- Never throws; internal failures are caught and reported as `{ ok: false }`.

### Concurrency

Two overlapping invocations (e.g. a scheduled run overlapping a manually
triggered one) are safe: PostgreSQL's own row locking during the `DELETE`
resolves any overlap between their candidate sets — whichever transaction
commits first removes the rows; the other's `DELETE` simply finds those
specific ids already gone (zero rows affected for them, no error, no
deadlock). This is a single self-contained statement per invocation with no
cross-table lock ordering to manage, unlike the multi-table locking used
elsewhere in this codebase for goal/custodian lifecycle operations.

## Scheduling — assessed, not implemented

**Smallest reliable mechanism**: Vercel Cron Jobs, configured via a `crons`
entry in `vercel.json` pointing at a dedicated Route Handler, secured with
Vercel's own documented `CRON_SECRET` mechanism ([Managing Cron
Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs), updated
2026-08-11): Vercel automatically sends the configured secret as an
`Authorization: Bearer <CRON_SECRET>` header on every cron-triggered
request, and the route compares it before doing any work — this is the
built-in mechanism Vercel itself recommends specifically to prevent an
unauthenticated public caller from triggering the endpoint.

**This requires infrastructure this ticket does not build**, per its own
explicit instruction to stop before implementing scheduling infrastructure:

- A `vercel.json` (doesn't exist yet — no Vercel project is linked to this
  repository at all, confirmed in 7G.2.3).
- A `CRON_SECRET` environment variable (Vercel's own recommended minimum:
  "a random string of at least 16 characters").
- A new authenticated Route Handler (e.g.
  `app/api/internal/cleanup-member-auth-rate-limit/route.ts`) that checks
  the `Authorization` header against `CRON_SECRET` before calling
  `cleanupExpiredMemberAuthRateLimitBuckets()`, returning 401 otherwise —
  never exposing an unauthenticated cleanup trigger.

**Two things worth flagging for whoever builds this, learned from currently
verified Vercel documentation, not assumed:**

1. **Hobby-plan cron jobs can only run once per day** ("Cron jobs now
   support 100 per project on every plan" doesn't change this — the
   once-daily restriction on Hobby is a separate, current limitation). Which
   plan NIA's eventual Vercel project will be on isn't decided yet (no
   project exists), so the realistic cleanup cadence this mechanism can
   deliver isn't yet known either. A once-daily cadence is still sufficient
   to keep storage bounded (nothing about the retention contract requires
   near-real-time cleanup), just far less frequent than the 500–1000/batch
   sizing might suggest is intended.
2. **Vercel's own cron documentation explicitly recommends idempotent,
   reconciliation-based design** because delivery is "best effort" and can
   duplicate-invoke or occasionally miss a scheduled run. This cleanup
   service already satisfies that by construction: every invocation
   independently queries "what's expired as of right now" with no
   in-memory state carried between calls, so a missed run, a duplicate run,
   or two overlapping runs are all already safe (see "Concurrency" above) —
   no additional lock mechanism needs to be added for this specific
   requirement.

Nothing here should be built until the Vercel project itself exists and a
deployment decision confirms the plan tier.

## Failure behavior

A cleanup failure is fully independent of the limiter: `checkMemberAuthenticationRateLimit`
does not call, wait on, or branch on cleanup in any way. If cleanup errors
(e.g. a transient database failure during a scheduled run), the limiter
continues to enforce SOURCE/TARGET/GLOBAL exactly as before, including
continuing to fail closed on its *own* store errors — a cleanup failure
cannot disable or bypass authentication limiting, because there is no code
path connecting the two.
