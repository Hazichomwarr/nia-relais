# Phase 6 Personal Goal Lifecycle Freeze

Status: FROZEN

## Freeze statement

**PHASE 6 — PERSONAL GOAL COMPLETION & ARCHIVE: FROZEN**

Phase 6 establishes the forward-only lifecycle for Personal Goals. NIA remains
an accountability platform: it does not hold, receive, transfer, or custody
money. Completion and archive record a goal's lifecycle history; neither moves
money nor deletes financial history.

This phase includes:

- 6A — Domain audit;
- 6B — Provenance schema;
- 6B.1 — Migration deployment;
- 6C — Eligibility read model;
- 6D — Completion service;
- 6E — Completion Server Action;
- 6F — Completion UI;
- 6G — Archive service/action;
- 6H — Archive UI/read presentation;
- 6I — Live lifecycle/concurrency verification;
- 6J — Independent adversarial audit;
- 6J.1 — Proxy coverage correction; and
- 6K — Freeze documentation.

Future changes to lifecycle transitions, eligibility, historical Deposit
authority, provenance, or goal-row locking require deliberate domain review
and, where applicable, migration and history analysis.

## Lifecycle contract

The only V1 lifecycle is:

```text
ACTIVE → COMPLETED → ARCHIVED
```

There is no reopening, reversal, restoration, hard deletion, or automatic
completion in V1.

Completion requires all of the following:

- explicit owner confirmation;
- current `ACTIVE` status;
- `SUM(APPROVED Deposit.amount) >= targetAmount`; and
- the stored `unlockDate` has been reached.

Archive requires all of the following:

- explicit owner confirmation;
- current `COMPLETED` status; and
- zero `PENDING` Deposits.

Archive deliberately does not re-evaluate target or unlock-date eligibility.
An `ARCHIVED` goal cannot complete, and an `ACTIVE` goal cannot archive.

## Historical preservation

Completion and archive preserve the original goal's financial terms and stored
`unlockDate`. They do not rewrite a balance snapshot, target, weekly amount,
currency, or any other financial term.

They also preserve:

- every Deposit record and its recording/decision provenance;
- each historical responsible custodian;
- completion actor and timestamp;
- archive actor and timestamp; and
- original completion provenance after archive.

The lifecycle is history-preserving rather than corrective. It does not delete
or mutate historical financial facts.

## Accounting and time

The authoritative savings formula remains:

```text
savedAmount = SUM(Deposit.amount WHERE status = APPROVED)
```

`PENDING` and `REJECTED` Deposits contribute zero. Overfunding is allowed and
is not capped or rewritten.

Reaching the target before `unlockDate` does not unlock or complete a goal.
Reaching `unlockDate` while underfunded does not complete a goal. The weekly
commitment remains historical: V1 has no missed-week debt, streak, or automatic
completion machinery.

## Deposit and custodian interaction

New Deposit creation stops once a goal is completed. A successful historical
`clientOperationId` replay remains valid after completion or archive and does
not create a second Deposit.

Completion and archive do not end or cancel custodian assignments. Existing
pending custodian-mode Deposits may remain after completion, and historical
custodian decisions remain permitted. A pending Deposit blocks archive until it
is resolved; ending an assignment does not resolve its pending Deposits.

Decision authority remains historical:

```text
Deposit.responsibleCustodianId
  → GoalCustodian.id
  → historical GoalCustodian.userId
```

A replacement custodian never inherits authority over an earlier Deposit.

## Transactions, replay, and concurrency

Relevant writers follow the shared aggregate discipline:

```text
begin transaction
→ lock PersonalGoal row FOR UPDATE
→ read authoritative state
→ conditionally mutate
→ commit
```

Completion and archive use conditional status updates. Same-state replay is
idempotent and preserves the original actor/timestamp provenance. A conflicting
opposite transition is rejected safely. Future lifecycle, Deposit, and
custodian writers that coordinate on the same goal must preserve this locking
discipline.

## Provenance invariants

```text
ACTIVE
  completedAt   = null
  completedById = null
  archivedAt    = null
  archivedById  = null

COMPLETED
  completedAt   != null
  completedById != null
  archivedAt    = null
  archivedById  = null

ARCHIVED
  completedAt   != null
  completedById != null
  archivedAt    != null
  archivedById  != null
```

`completedById` and `archivedById` have restrictive actor foreign keys. These
status/provenance correlations are currently service-enforced; Phase 6 adds no
database `CHECK` constraints.

## UI contract

Eligibility is server-authoritative. Completion and archive both require
explicit confirmation and only show success feedback after the authoritative
operation succeeds.

- Completion can show pending savings as information without blocking a valid
  completion.
- Archive treats pending savings as a blocker.
- Completed and archived goals have distinct lifecycle presentation.
- Completed goals have no new-Deposit CTA; archived history remains accessible.
- There are no reopen or delete controls.
- Replay does not manufacture a second celebration.
- Archive does not imply deletion or money movement.

## Verification evidence

### Ticket 6I — live database verification

Temporary, uniquely identified fixtures exercised live eligibility,
provenance, archive, historical-custodian, and concurrency behavior. The
baseline and final counts matched exactly:

- User: 2;
- PersonalGoal: 2;
- Deposit: 14; and
- GoalCustodian: 2.

Temporary fixtures were cleaned in FK-safe order. Evidence includes live
database/service checks, not a browser E2E claim.

### Ticket 6J — independent adversarial audit

The audit verdict was **READY TO FREEZE WITH DOCUMENTED DEFERRALS**. It found
no P0 or P1 issues; all six named race classes were live-tested. The
COMPLETED-state Deposit replay gap was live-verified, and the
completion-versus-archive race assertion was corrected and rerun. The audit
made no application or data changes.

### Ticket 6J.1 — HTTP proxy verification

The Proxy matcher covers dashboard, goals, custodian, and deposits routes.
Unauthenticated requests to each protected route returned `307` to `/login`.
The public `/`, `/login`, and `/register` routes returned `200`.

Proxy is an optimistic navigation gate only. The authenticated app layout's
`requireUser()` boundary and service-level ownership checks remain
authoritative.

## Documented deferrals

- Authenticated browser E2E through completion/archive actions was not run.
- Authenticated-route Proxy verification was not run because no safe existing
  authenticated browser session was available.
- Date helpers remain duplicated.
- Lifecycle status/provenance correlations remain service-enforced rather than
  database `CHECK`-enforced.

The earlier Proxy matcher coverage gap is closed by Ticket 6J.1 and is not an
open deferral.

## Out of scope

Phase 6 does not add:

- reopening or restoration;
- corrections or reversals;
- hard deletion or anonymization;
- automatic completion;
- missed-week debt or streak machinery;
- notifications;
- custodian replacement orchestration;
- SUSU lifecycle; or
- money movement or custody.

## Freeze boundary

**PHASE 6 — PERSONAL GOAL COMPLETION & ARCHIVE: FROZEN**

This freeze covers lifecycle eligibility, forward-only completion/archive
transitions, actor provenance, historical Deposit and custodian preservation,
goal-row locking, and lifecycle presentation.
