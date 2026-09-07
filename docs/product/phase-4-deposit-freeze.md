# Phase 4 Deposit Freeze

Status: frozen

Phase 4 establishes the PersonalGoal Deposit accounting foundation. This
document records the stable contract that Phase 5 Custodian work and Phase 6
Completion work must consume.

## Domain contract

A Deposit is an accounting statement of money saved outside NiaRelais. NiaRelais
does not hold, receive, transfer, or custody money.

`PersonalGoal` owns the commitment contract. `Deposit` owns the accounting fact
and its verification history.

- Deposit currency is inherited from the goal's immutable currency.
- Deposit amount is positive `DECIMAL(18,2)`.
- `weeklyAmount` is a commitment expectation, not a Deposit cap.
- Multiple, catch-up, smaller, larger, and overfunding Deposits are allowed.

## Creation lifecycle

Only `ACTIVE` goals accept new Deposits. `COMPLETED` and `ARCHIVED` goals are
read-only for Deposit creation.

### No active custodian

```text
OWNER verification
→ APPROVED immediately
→ owner is recorder and approver
```

### Active custodian

```text
CUSTODIAN verification
→ PENDING
→ exact GoalCustodian assignment is snapshotted
```

A successful historical operation may be replayed after a goal lifecycle
change without creating a new Deposit.

## Historical integrity

The following facts are preserved by the Deposit model and creation contract:

- `goalId`;
- `recordedById`;
- `amount`;
- `depositDate`;
- `verificationMode`;
- `responsibleCustodianId`;
- approval and rejection actors and timestamps;
- `rejectionReason`;
- `clientOperationId`.

The responsible custodian relation uses a same-goal composite foreign key:

```text
Deposit(responsibleCustodianId, goalId)
  → GoalCustodian(id, goalId)
```

The goal, recorder, approver, rejector, and responsible-custodian foreign keys
use restrictive deletion behavior. Financial history cannot be removed by
cascading goal, user, or custodian deletion.

### Constraint boundaries

Database-enforced constraints include:

- Decimal precision for Deposit amounts;
- required and nullable columns;
- `UNIQUE(goalId, clientOperationId)`;
- same-goal responsible-custodian relationship;
- restrictive foreign keys.

Service-enforced invariants include:

- only ACTIVE goals accept new Deposits;
- no active custodian selects OWNER verification and immediate approval;
- an active custodian selects CUSTODIAN verification and PENDING status;
- rejection reasons are required for rejected records by domain policy;
- verification responsibility is selected from the creation-time context;
- Deposit dates stay between the goal start date and UTC today.

The database does not currently enforce Deposit immutability with a CHECK
constraint or trigger. Approved and historical Deposit mutation remains
unsupported by the application contract and requires a future correction/void
ledger design.

## Idempotency

Deposit creation uses:

```text
UNIQUE(goalId, clientOperationId)
```

The same goal and operation ID return the same logical Deposit. Concurrent
duplicate creation cannot produce duplicate accounting facts through the
unique database constraint and conflict-replay handling.

The current replay policy returns the original record even if replay input
differs. It does not mutate the original amount, date, or note. Later API and
UI work must preserve this policy.

## Money and date conventions

- Monetary arithmetic uses `Prisma.Decimal` or equivalent exact Decimal logic.
- No JavaScript floating-point monetary arithmetic is used.
- Monetary values are serialized as fixed decimal strings.
- Dates use strict `YYYY-MM-DD` input.
- Date-only values persist as UTC-midnight `DateTime` values.
- `depositDate` is the date the owner says the saving occurred.
- `createdAt` is the record creation timestamp and is not a substitute for
  `depositDate`.
- Backdating from `goal.startDate` through today is allowed.
- Future Deposit dates are rejected.

The known V1 limitation remains: the server uses UTC “today”, so users near a
UTC calendar boundary may experience a narrow date-entry UX discrepancy. This
does not compromise stored date integrity.

## History and progress truth

Deposit history is owner-scoped and ordered newest savings date first, with
deterministic creation-time and ID tie-breakers.

Human status copy is:

- `APPROVED` → **Confirmed**;
- `PENDING` → **Awaiting confirmation**;
- `REJECTED` → **Not confirmed**.

Rejection reasons are shown when present. Historical verification mode is read
from the Deposit record and is never re-derived from the current custodian
relationship.

The authoritative progress formulas are:

```text
savedAmount = SUM(Deposit.amount WHERE status = APPROVED)
remainingAmount = max(targetAmount - savedAmount, 0)
progressPercent = savedAmount / targetAmount × 100
```

Pending and rejected Deposits are excluded. No persisted balance is used.
Overfunding remains visible in saved amount and textual percentage; only the
visual progress bar may clamp at 100%. Reaching the target does not imply
`GoalStatus = COMPLETED`.

## Authorization boundaries

- Authentication resolves a verified platform `User`.
- `requireGoalOwner(goalId)` establishes individual aggregate authority.
- Dashboard and history queries use trusted owner-scoped goal IDs.
- A client-supplied `goalId` identifies the aggregate to authorize; it is not
  proof of ownership.
- Recorder, approver, verification mode, responsible custodian, and status are
  never accepted as client-controlled provenance fields.
- Missing and unauthorized goals remain externally indistinguishable.
- The Deposit Server Action is orchestration-only: it extracts FormData,
  delegates validation and domain behavior, maps safe errors, and redirects.

## Phase 5 consumption rules

Phase 5 must preserve the Phase 4 creation contract.

Before implementing custodian mutations, Phase 5 must audit and resolve the
concurrency interaction between:

- active custodian lookup;
- custodian assignment, removal, or replacement;
- Deposit creation.

READ COMMITTED behavior alone must not be assumed to prevent a responsible-
custodian race. Phase 5 must also enforce valid approval/rejection state
combinations and conditional transitions.

Historical `responsibleCustodianId` must never be rewritten when assignments
change.

## Deferred risks and behavior

Phase 5 defers:

- custodian onboarding and assignment;
- custodian authority;
- approve/reject transitions;
- concurrency policy for custodian changes.

Phase 6 defers:

- completion and unlock rules;
- pending-at-completion behavior;
- archive lifecycle.

Later work defers:

- correction/void ledger;
- cancellation semantics;
- weekly adherence and reminders;
- GentleFeedback;
- shared date/money helper extraction;
- a formal automated test harness.

These are not silently resolved by this freeze.

## Audit evidence

The Phase 4 audit result was:

```text
A — READY TO FREEZE
27/27 checks passed
```

Evidence included rollback and commit-then-cleanup verification, with zero
durable test rows remaining. The auth request-context limitation was explicitly
noted. Lint, build, Prisma validation, migration status, and diff checks
passed, with no required corrective fixes.

This evidence does not claim that full browser end-to-end testing occurred.

## Verification

The freeze documentation was added without changing production behavior,
schema, migrations, dependencies, UI, services, repositories, actions, or
database state.
