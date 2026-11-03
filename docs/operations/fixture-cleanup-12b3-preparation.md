# Controlled fixture cleanup — preparation only

Status: **no deletion is authorized by this document.**

## Target identity gate

Before any future execution, a founder must re-run a read-only target check
and require all of the following exact values:

- Neon project: `nia-relais` (live project ID must match the founder-approved mapping)
- Neon branch ID: `br-withered-dew-ai500t3r`
- database: `neondb`
- schema: `public`
- deployment relationship: Vercel Production uses this branch

The procedure stops if any value cannot be independently verified. It must not
substitute a similar endpoint, database name, or branch.

## Manifest gate

Create a transaction-local manifest immediately before an approved execution.
It must select only the three known creators and matching fixture email forms:

```sql
WITH candidate AS (
  SELECT id, name, email
  FROM "User"
  WHERE (name = 'PAYOUT_DISPUTE_TEST_OWNER'
         AND email LIKE 'payout-dispute-test-owner-%@example.invalid')
     OR (name = 'OWNER_READ_TEST_OWNER'
         AND email LIKE 'owner-read-test-owner-%@example.invalid')
     OR (name = 'ROUND_LIFECYCLE_TEST_OWNER'
         AND email LIKE 'round-lifecycle-test-owner-%@example.invalid')
)
SELECT name, id, email
FROM candidate
ORDER BY name, id;
```

The manifest is invalid if it includes the configured super-admin ID, any
unexpected creator/email combination, or any cross-scope reference. Never use
a historical manifest as execution input.

## Read-only dry run

The dry run must perform only `SELECT` queries and report:

1. target identity and current timestamp;
2. exact candidate counts by family and IDs;
3. rows reachable from candidate-owned circles in every table below;
4. direct User foreign-key references to candidate IDs;
5. any noncandidate User/member/actor reference in a candidate circle;
6. founder exclusion;
7. post-cleanup metric baselines; and
8. snapshot name/timestamp and confirmed restoration test plan.

It must stop on any non-zero cross-scope result. A `DELETE ... ROLLBACK` is
not a dry run and is prohibited.

## Future execution-only sequence

This sequence requires a separate written founder deletion approval and a
maintenance/concurrency plan. It is deliberately not executable SQL.

1. Reconfirm target identity, snapshot availability, and approved maintenance
   window.
2. Begin one serializable transaction and take the appropriate advisory lock
   for this one-off maintenance operation.
3. Rebuild the manifest and re-run all dry-run guards inside the transaction.
4. Abort if the manifest, founder exclusion, dependency counts, or any
   cross-scope result differs from the approved dry run.
5. Delete only manifest-reachable rows in restrictive-FK order:
   `CircleMemberSession` → `ContributionPayment` → `Payout` →
   `ContributionObligation` → `PayoutRound` → `CircleMember` →
   `SavingsCircle` → `User`.
6. Verify each affected-row count against the in-transaction manifest; abort
   on any mismatch. No cascade, wildcard, or application endpoint may be
   used.
7. Commit only after the count and foreign-key checks pass. Otherwise roll
   back the complete transaction.

## Post-cleanup read-only reconciliation

After a separately approved and completed transaction, run read-only checks
that prove:

- no exact-family candidate user remains;
- no candidate-owned circle, member, round, obligation, payment, payout, or
  member session remains;
- the configured super-admin remains present and can still pass the normal
  database-backed admin check;
- no remaining foreign-key violation exists;
- noncandidate `User`, `PersonalGoal`, `Deposit`, and `GoalCustodian` counts
  match their pre-execution baselines;
- registered-user total equals the pre-execution total minus the actual
  manifest count;
- SUSU owner/circle adoption totals equal their baselines minus the actual
  deleted candidate-owned rows; and
- Personal Savings adoption remains unchanged.

Do not expect a fixed final registration count: live users may register
between the preflight and the approved maintenance window.

## Recovery test plan

The founder-created November 3, 2026 19:04:50 UTC Neon snapshot is a recovery
checkpoint, not evidence that restoration has already been tested. Before any
future deletion, restore that snapshot into a new isolated Neon branch, attach
a separate compute endpoint, and validate the manifest/count queries there.
Do not point the Production endpoint or Vercel variables at the restored
branch. Record the temporary branch/endpoint identity and remove it only after
the founder has accepted the recovery test results.

Neon snapshots can be restored into a new branch without changing the source
branch; branch/PITR restoration has retention and post-restore-write-loss
considerations that must be confirmed in the Neon project before execution.
