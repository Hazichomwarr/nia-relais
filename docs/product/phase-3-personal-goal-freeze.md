# Phase 3 Personal Goal Freeze

Status: frozen

Phase 3 establishes the first PersonalGoal experience in NiaRelais. This
document is the architecture and product boundary for that experience. Future
work must consume this contract rather than silently changing it.

## Frozen PersonalGoal V1 contract

PersonalGoal V1 is:

- owned by exactly one platform `User`;
- weekly by design;
- created with a required, positive `targetAmount`;
- created with a required, positive `weeklyAmount`;
- assigned one immutable currency;
- assigned an immutable `targetAmount`;
- assigned an immutable `weeklyAmount`;
- assigned an immutable `startDate`;
- assigned an immutable `unlockDate`;
- created with status `ACTIVE`;
- created with `completedAt = null`;
- created with `archivedAt = null`.

Multiple `ACTIVE` goals are allowed for one platform user.

The lifecycle is:

```text
ACTIVE → COMPLETED → ARCHIVED
```

Cancellation is not represented in Phase 3. No Phase 3 behavior should imply
that cancellation exists.

## Creation flow

The implemented creation path is:

```text
/goals/new
  → createPersonalGoalAction
  → createPersonalGoalSchema
  → requireUser()
  → createPersonalGoal()
  → createPersonalGoalRecord()
  → Prisma
  → redirect("/dashboard")
```

`ownerId` never comes from client input. Ownership is derived from the trusted
authenticated platform `User` returned by `requireUser()`.

Creating a PersonalGoal does not create `Deposit`, `GoalCustodian`, or SUSU
records.

## Money convention

- Form amounts arrive as decimal strings.
- Validation limits them to positive values compatible with `DECIMAL(18,2)`.
- No JavaScript floating-point arithmetic is used for validation or persistence.
- The service converts validated strings to `Prisma.Decimal`.
- The dashboard read model serializes Decimal values safely for presentation.
- Phase 3 performs no currency conversion.

The current input and display scope supports `USD`, `EUR`, and `XOF`. This is
display/input scope only; it is not currency-conversion support.

## Date convention

- The UI uses `YYYY-MM-DD` date-only inputs.
- Validation uses date-only semantics.
- The service persists dates as UTC-midnight `DateTime` values.
- The dashboard serializes dates back to date-only ISO strings.
- The UI formats dates with UTC-safe display logic.

An empirical audit confirmed no date drift across:

- `America/New_York`;
- `America/Los_Angeles`;
- `Africa/Ouagadougou`.

Known V1 limitation: future/past validation uses server UTC “today”. Users in
some timezones may therefore encounter a narrow calendar-boundary UX
discrepancy around UTC midnight. This is not a data-integrity issue.

## Dashboard read model boundary

`getPersonalGoalsForDashboard(user)` is the Phase 3 read model.

Its rules are:

- trusted `user.id` is the sole owner scope;
- multiple active goals are supported;
- goals are ordered `ACTIVE`, then `COMPLETED`, then `ARCHIVED`;
- newest-created goals appear first within each lifecycle group;
- Decimal values are serialized safely;
- dates are serialized safely;
- an empty `[]` result is valid;
- no `Deposit` or `GoalCustodian` relations are loaded;
- the read model performs no mutations.

## Dashboard truth boundary

The Phase 3 dashboard may display:

- goal name;
- currency;
- target amount;
- weekly commitment;
- unlock date;
- lifecycle status.

It must not infer or display any of the following as if they were known:

- saved amount;
- remaining amount;
- progress percentage;
- weekly success;
- streak;
- “on track” status;
- deposit count;
- custodian state.

Those concepts belong to later phases and require additional approved domain
truth.

## Authorization boundary

Authentication is established with:

```text
requireUser()
```

Collection authority is:

```text
trusted user.id
  → owner-scoped PersonalGoal query
```

Individual-goal authority is intended to be:

```text
requireGoalOwner(goalId)
```

`requireGoalOwner(goalId)` is not implemented yet because Phase 3 has no
`/goals/[id]` aggregate route. It must be introduced before future
individual-goal reads or mutations that require ownership authorization.

## Route-protection boundary

The optimistic `proxy.ts` matcher includes:

```text
/dashboard/:path*
/goals/:path*
```

Proxy authentication is optimistic only. The authoritative protection
boundary remains:

```text
app/(app)/layout.tsx
  → requireUser()
```

## Historical-integrity boundary

Phase 3 contains no PersonalGoal update, delete, or upsert operation. As a
result, no current code path can rewrite:

- owner;
- currency;
- `targetAmount`;
- `weeklyAmount`;
- `startDate`;
- `unlockDate`;
- lifecycle timestamps.

Future mutations must preserve this contract and must not rewrite historical
PersonalGoal truth as a side effect of unrelated behavior.

## Deferred behavior

The following are explicitly not part of Phase 3:

- Deposit lifecycle;
- saved-amount or progress calculations;
- GoalCustodian lifecycle;
- goal detail route;
- goal editing;
- completion transition behavior;
- archival transition behavior;
- cancellation;
- PWA work;
- an FR/EN localization system;
- GentleFeedback animations;
- SUSU behavior;
- the individual-goal authorization primitive;
- an automated regression test suite.

The repository currently has no automated test runner configured.

## Phase 4 consumption rules

Phase 4 Deposit work must treat the Phase 3 PersonalGoal contract as frozen.

Deposit implementation may:

- reference `goalId`;
- verify owner authority;
- read goal status;
- derive progress from approved deposits.

Deposit implementation must not:

- rewrite `targetAmount`;
- rewrite `weeklyAmount`;
- rewrite currency;
- rewrite `startDate`;
- rewrite `unlockDate`;
- overload `GoalStatus` for deposit state;
- mutate historical Deposit truth through PersonalGoal changes.

Any behavior that requires changing the frozen PersonalGoal contract must be
treated as a new architecture decision, not as an incidental Phase 4 change.
