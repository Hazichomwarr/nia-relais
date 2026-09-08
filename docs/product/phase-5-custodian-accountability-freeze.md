# Phase 5 Custodian Accountability Freeze

Status: frozen

## Freeze statement

**PHASE 5 — CUSTODIAN ACCOUNTABILITY: FROZEN**

Phase 5 allows a PersonalGoal owner to designate a trusted platform User who
confirms future savings Deposits. NiaRelais does not hold money, move money,
act as custodian of funds, or transfer funds. It tracks accountability and
verification only.

The Ticket 5W adversarial audit verdict was **READY TO FREEZE WITH DOCUMENTED
DEFERRALS**. No P0 or P1 defects were found. Historical authority, tenant
isolation, and critical concurrency behavior were verified. Browser and request-
context limitations remain explicitly documented below.

Future changes to assignment lifecycle, historical authority, Deposit
responsibility, lock ordering, or approved-only accounting require deliberate
domain review and migration/history analysis where applicable.

## Assignment lifecycle

The frozen GoalCustodian lifecycle is:

```text
PENDING → ACTIVE
PENDING → DECLINED
PENDING → CANCELLED
ACTIVE  → ENDED
```

`DECLINED`, `CANCELLED`, and `ENDED` are terminal. No assignment reactivates;
a future relationship creates a new GoalCustodian row.

The meanings are distinct:

- `DECLINED`: the assigned User declined the request.
- `CANCELLED`: the goal owner withdrew a still-PENDING request.
- `ENDED`: the owner ended a role that had previously become ACTIVE.

These states must not be reused interchangeably. Assignment rows are preserved;
Phase 5 does not hard-delete rows or rewrite one identity into another.

## Historical provenance

Assignment creation preserves:

- `assignedById` and `assignedAt`;
- `userId`;
- the `displayName` and email snapshot.

Acceptance records `acceptedAt`. Decline records `declinedAt`. Cancellation
records `cancelledAt` and `cancelledById`. Ending records `endedAt` and
`endedById`.

The original assignment identity and history remain authoritative even after a
role ends or a request is cancelled.

## Authorization

Owner mutations resolve the assignment to its PersonalGoal and authorize
against the actual `PersonalGoal.ownerId`. A client-supplied goal ID, email,
display name, or custodian user ID is not proof of ownership.

Custodian assignment decisions authorize through the exact
`GoalCustodian.userId`. Null-user assignments cannot authenticate.

Deposit decisions authorize through:

```text
Deposit.responsibleCustodianId
→ GoalCustodian.id
→ historical GoalCustodian.userId
```

Email and display name are never authorization fields.

## Concurrency and locking

Every custodian-sensitive writer follows this application discipline:

```text
begin transaction
→ lock PersonalGoal FOR UPDATE
→ read authoritative custodian state
→ conditionally mutate
→ commit
```

This applies to assignment creation, acceptance, decline, cancellation, role
ending, Deposit creation, and custodian Deposit approval/rejection.

This is a required application discipline. READ COMMITTED isolation alone does
not provide the required invariant. Future writers must use the same lock order.

## Open-assignment invariant

Open assignments are exactly:

- `PENDING`;
- `ACTIVE`.

Historical/non-open assignments are:

- `DECLINED`;
- `CANCELLED`;
- `ENDED`.

The database enforces one ACTIVE custodian per goal with the partial unique
index `GoalCustodian_one_active_per_goal_idx`. Its predicate is
`status = ACTIVE`. The service layer also checks for an active custodian before
activation.

The PENDING/ACTIVE open-assignment rule remains service-level. Once an
assignment becomes terminal, the owner may create a new PENDING row. Phase 5
does not provide automatic replacement or a combined end-and-replace flow.

## Deposit creation

With no ACTIVE custodian:

```text
OWNER verification
→ APPROVED immediately
→ no responsibleCustodianId
```

With exactly one ACTIVE custodian:

```text
CUSTODIAN verification
→ PENDING
→ responsibleCustodianId snapshots the ACTIVE GoalCustodian row
```

A merely PENDING assignment does not affect Deposit behavior.

## Historical Deposit authority

The critical frozen invariant is:

```text
C1 ACTIVE
→ D1 created as CUSTODIAN/PENDING
→ owner ends C1
→ C2 later becomes ACTIVE
```

Then:

- D1 remains assigned to C1;
- C1 retains authority to approve or reject D1, even after becoming ENDED;
- C2 has no authority over D1;
- the owner does not inherit authority;
- D1 is never automatically transferred, approved, or rejected.

Ending changes responsibility for future Deposits only. Cancellation does not
create historical Deposit authority because a PENDING assignment was never
active responsibility.

## Deposit decisions

Only the historically responsible custodian may decide a custodian-mode
Deposit:

```text
PENDING → APPROVED
PENDING → REJECTED
```

Approval writes `approvedAt` and `approvedById`. Rejection writes `rejectedAt`,
`rejectedById`, and a required trimmed rejection reason of at most 500
characters.

Same-state replay is idempotent. Opposite-state replay is a safe conflict. The
first decision's actor, timestamp, and rejection reason remain authoritative.

## Accounting

The authoritative formula is:

```text
savedAmount = SUM(Deposit.amount WHERE status = APPROVED)
```

Therefore:

- OWNER/APPROVED counts;
- CUSTODIAN/PENDING does not count;
- CUSTODIAN/APPROVED counts;
- REJECTED does not count;
- custodian assignment status never changes savings totals.

Overfunding remains allowed. Phase 5 never automatically completes a goal.

## Goal lifecycle interaction

Opening new authority requires an ACTIVE goal:

- new custodian assignment;
- custodian acceptance;
- new Deposit.

Closing or resolving historical state remains allowed regardless of goal
lifecycle:

- declining a PENDING assignment;
- cancelling a PENDING assignment;
- ending an ACTIVE assignment;
- deciding an already-existing PENDING custodian Deposit.

Phase 6 must preserve historical Deposit decision authority after completion or
archive unless it deliberately redesigns the history contract and migration
rules.

## Owner UI contract

- PENDING: awaiting acceptance; owner may **Cancel request**.
- ACTIVE: current trusted person; owner may **End trusted person role**.
- DECLINED: historical, rendered as **Previous request declined.**
- CANCELLED: historical, rendered as **Previous request cancelled.**
- ENDED: historical, rendered as **Previous trusted-person role ended.**

When no PENDING or ACTIVE assignment exists and the goal is ACTIVE, the owner
may create a new request. There is no combined replace flow.

## Custodian UI contract

- PENDING: actionable accept/decline request.
- ACTIVE: active assignment context.
- DECLINED: terminal historical state.
- CANCELLED: terminal, non-actionable state indicating the owner cancelled the
  request.
- ENDED: historical role; the exact GoalCustodian row may retain authority over
  historically assigned Deposits.

The pending Deposit queue is scoped by exact historical responsibility and does
not infer identity from email.

## Read-model limitations

GoalCustodian persistence preserves complete assignment history. The owner
dashboard exposes the current open assignment and one relevant historical
assignment; it is not a complete assignment timeline. This is a presentation
limitation, not a persistence limitation.

## Database-enforced versus service-enforced rules

Database-enforced guarantees include:

- one ACTIVE custodian per goal;
- same-goal Deposit responsibility foreign key;
- restrictive provenance foreign keys;
- required Deposit recorder;
- unique `(goalId, clientOperationId)`;
- Deposit money precision.

Service/application guarantees include:

- terminal assignment immutability;
- correlation of statuses with timestamps and actors;
- one open PENDING/ACTIVE relationship;
- canonical PersonalGoal row-lock ordering;
- historical authority and replay behavior.

Service-only rules must not be described as database constraints.

## V1 identity limitation

Assignment creation currently requires the candidate to already be an existing
platform User. Although `GoalCustodian.userId` is nullable, invite-before-
account-exists and account-claim flows are not implemented. Email invitation or
account provisioning must not be implied.

## Verification evidence

Ticket 5V used temporary, uniquely tagged fixtures against the live PostgreSQL
database and cleaned them in FK-safe order. It empirically exercised assignment
creation, acceptance, decline, cancellation, ending, Deposit queue and
decision behavior, historical read models, and critical accept/cancel,
cancel/cancel, and end/end races. The partial ACTIVE index and historical
responsibility relationships were verified against the live database.

The final live baseline was restored exactly:

- User: 1;
- PersonalGoal: 4;
- GoalCustodian: 0;
- Deposit: 3;
- all GoalCustodian status counts: 0.

The evidence does not claim a full authenticated browser-driven Server Action
E2E suite. The complete lifecycle cross-product was not individually live-
tested in every permutation, and some client rendering was verified from
source rather than browser automation. These are documented limitations, not
P0/P1 defects.

## Deferred findings and out-of-scope work

The `/custodian` route is protected authoritatively by app-level `requireUser()`
and unauthenticated access was verified to redirect to `/login`. `proxy.ts`
does not currently include `/custodian/:path*`; this is a P2 defense-in-depth
and hygiene gap, not a security defect, and is deferred.

The following P3 cleanup items are also deferred:

- unreachable hardcoded fallback in `classifyCancellationState`;
- minor not-found versus unauthorized distinction;
- duplicated pending-Deposit JSX on the custodian page;
- duplicated date and money helpers.

Other deferred V1 capabilities include:

- invite-before-account-exists and claim flow;
- email notifications;
- replacement orchestration;
- full custodian history UI;
- database CHECK constraints for status/provenance correlation;
- hard-delete and account-anonymization policy;
- Deposit correction/reversal framework;
- authenticated browser E2E suite;
- shared date/money helper cleanup.

## Phase 6 carryover

Phase 6 must explicitly decide:

- reaching the target does not automatically mean COMPLETED;
- completion/archive must not silently strand existing PENDING custodian
  Deposits;
- historical custodian authority currently survives goal completion and
  archive;
- completion/archive prerequisites and pending-Deposit handling;
- no action may retroactively rewrite Deposit history.

## Freeze boundary

**PHASE 5 — CUSTODIAN ACCOUNTABILITY: FROZEN**

This freeze covers assignment lifecycle, historical provenance, owner and
custodian authority, PersonalGoal lock ordering, Deposit responsibility,
historical Deposit decisions, and approved-only accounting. Changes to these
contracts require deliberate domain review and, where applicable, migration and
history analysis.

