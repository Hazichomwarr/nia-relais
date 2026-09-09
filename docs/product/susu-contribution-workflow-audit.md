# SUSU Contribution Workflow — Domain Audit (7J)

Status: AUDIT ONLY. No application code, schema, migration, or test was
changed to produce this document. It establishes the authoritative
accounting rules, state transitions, ownership boundaries, historical
preservation, and a proposed (not yet built) implementation sequence for
recording and confirming SUSU contribution payments — the one financial
mutation surface that remains entirely unimplemented after 7G–7I.

Every claim below is sourced from `prisma/schema.prisma`, the migration SQL
in `prisma/migrations/20260908225541_susu_v1_persistence_contract/`,
`src/services/circle.service.ts`, `src/repositories/circle-lock.repository.ts`,
`src/services/circle-member-dashboard.service.ts` and its repository,
`src/services/circle-active-owner.service.ts` and its repository, and
`src/validations/circle.schema.ts` — not reconstructed from ticket
descriptions.

## 1. Existing implementation inventory

**Schema models (all exist, migrated):** `ContributionObligation`,
`ContributionPayment`, `PayoutRound`, `SavingsCircle`, `CircleMember`. Full
field lists confirmed by direct schema read:

- `ContributionObligation`: `id`, `circleId`, `roundId`, `memberId`,
  `expectedAmount` (`Decimal(18,2)`), `currency`, `dueDate`, `status`
  (`OPEN`/`FULFILLED`), `fulfilledAt`, `createdAt`, `updatedAt`. Constraints:
  `@@unique([roundId, memberId])`, `@@unique([id, circleId])`,
  `@@index([circleId, roundId, status])`.
- `ContributionPayment`: `id`, `circleId`, `obligationId`, `amount`,
  `currency`, `status` (`RECORDED`/`CONFIRMED`/`REJECTED`),
  `clientOperationId`, `recordedAt`/`recordedById`,
  `confirmedAt`/`confirmedById`, `rejectedAt`/`rejectedById`,
  `rejectionReason` (`VarChar(500)`, nullable), `createdAt`, `updatedAt`.
  Constraints: `@@unique([circleId, clientOperationId])`,
  `@@index([circleId, obligationId, status])`, **plus** a partial unique
  index not expressible in the Prisma schema DSL, added directly in the
  migration SQL: `ContributionPayment_one_unresolved_or_confirmed_per_obligation_idx`
  on `(obligationId)` `WHERE status IN ('RECORDED', 'CONFIRMED')`.

**Runtime writers that exist today:** only `activateCircle`
(`circle.service.ts`) ever creates a `PayoutRound` or `ContributionObligation`
row — one round per member and one obligation per (round, member) pair, all
at once, at activation. **Confirmed to have zero runtime writer anywhere in
`src/`:** nothing creates, confirms, or rejects a `ContributionPayment`;
nothing transitions `PayoutRound.status` away from `UPCOMING`; nothing ever
writes `ContributionObligation.status = FULFILLED`. This restates and
extends the 7H/7I audits' own finding: the SUSU *schedule* is fully
materialized at activation, the SUSU *ledger* has no writer at all.

**Existing read models relevant to this workflow:**
- `circle-member-dashboard.service.ts` (7H.2) — member-facing. Already
  establishes the authoritative accounting formula (confirmed-amount as a
  ledger sum, `fulfilled` derived from the ledger and never from
  `ContributionObligation.status`, aggregate-only round progress with no
  per-member breakdown) and the member's own payout state machine
  (`RECORDED`/`CONFIRMED`/`DISPUTED`, never inferring receipt from round
  status). Its repository's queries are deliberately narrow for member
  privacy and are **not** reusable as-is for an owner-facing view (see
  §8).
- `circle-active-owner.service.ts` (7I.6) — owner-facing ACTIVE circle
  summary: terms, ordered members, full persisted rotation, current/next
  round. Explicitly carries **no** financial totals (out of that ticket's
  scope) — the gap this audit exists to fill.
- `circle-activation-review.service.ts` (7I.5) — not directly reusable
  (DRAFT-only), but its Decimal-exact totals pattern
  (`Prisma.Decimal.times()`/`.toFixed(2)` only at the serialization
  boundary) is the established precedent to follow again here.

**Validation schemas:** `circle.schema.ts` covers circle creation, member
creation, and payout ordering only. **No schema exists yet** for a
contribution amount, a rejection reason, or a `clientOperationId` shape.

**Locking:** `circle-lock.repository.ts`'s `lockSavingsCircleForUpdate`
(`SELECT ... FOR UPDATE` on `SavingsCircle`) is the established "canonical
SUSU lock order" — documented in its own comment: *"begin a transaction,
lock the SavingsCircle, then read or mutate circle-scoped state. The lock
coordinates writers; it does not establish owner authority."* Every DRAFT
mutation and `activateCircle` itself already follows this. Nothing yet
locks at round or obligation granularity — none has been needed, since
nothing writes at that granularity yet.

**Do not assume persistence implies workflow:** restated as the audit's own
governing finding — `ContributionObligation`/`ContributionPayment`/
`PayoutRound` all exist, fully indexed and constrained, with **zero**
application code that writes to two of the three, and only one writer
(activation) for the third.

## 2. Historical-authority decisions

**"What historical information must a contribution preserve?"**

- **Original obligation identity** — `ContributionObligation.id`, frozen at
  activation. The permanent identity anchor for "this member's obligation
  for this round." Immutable.
- **Frozen expected amount and currency** — `expectedAmount`/`currency`,
  set once at activation from the circle's terms at that instant. Immutable
  — no service anywhere edits a `SavingsCircle`'s `contributionAmount`/
  `currency` after creation, and even if one existed, this obligation-level
  snapshot would still be the authoritative historical value, not a live
  re-read of the circle.
- **Original due date** — `dueDate`, computed once via the shared
  `roundDueDate` helper (`src/domain/circle-rotation-schedule.ts`, 7I.5) at
  activation. Immutable.
- **Member identity** — `memberId` (FK). Immutable; the compound FK
  `[memberId, circleId] -> [id, circleId]` makes it structurally impossible
  for an obligation to ever reference a member from a different circle.
- **Recorded amount** — `ContributionPayment.amount`. Set once at row
  creation. A payment row's amount must never be edited after creation — a
  wrong amount is corrected by rejecting that row and recording a new one,
  never by updating the existing row in place.
- **Recording actor and timestamp** — `recordedById`/`recordedAt`.
  Immutable once set.
- **Confirmation/rejection actor and timestamp** — `confirmedById`/
  `confirmedAt` **or** `rejectedById`/`rejectedAt` (mutually exclusive, set
  exactly once, on the single transition out of `RECORDED`). Immutable
  once set — no code path should ever clear or reassign either pair.
- **Rejection reason** — `rejectionReason`. Set once, at rejection.
  Immutable after.
- **Idempotency operation identity** — `clientOperationId`, unique per
  `(circleId, clientOperationId)`. Guards a retried submission from
  becoming a duplicate row.
- **Historical rejected attempts** — preserved forever. The partial unique
  index's `WHERE` clause deliberately excludes `REJECTED`, so unlimited
  `REJECTED` rows may accumulate per obligation — a full audit trail of
  every recording attempt, successful or not, exactly mirroring the
  `Deposit`/`GoalCustodian` history convention already established
  elsewhere in this codebase (soft state changes, never hard deletes).

**Immutable facts:** everything on `ContributionObligation` (identity,
expected amount, currency, due date, member/round linkage); everything on a
`ContributionPayment` row once created, **except** its own `status` and the
one corresponding actor/timestamp/reason pair, which are set exactly once
on the single permitted transition out of `RECORDED`.

**Permitted state transition:** `RECORDED → CONFIRMED` or
`RECORDED → REJECTED`, exactly one, terminal. No code should ever overwrite
or delete a `ContributionPayment` or `ContributionObligation` row — this
matches the ticket's explicit instruction and is already how every other
financial-adjacent history in this codebase behaves (`Deposit`,
`GoalCustodian`, `CircleMemberSession` revocation).

## 3. Accounting invariants

**The `ContributionObligation` ↔ `ContributionPayment` relationship, precisely:**
one obligation may accumulate many `ContributionPayment` rows over its
lifetime, but the partial unique index guarantees **at most one row with
status `RECORDED` or `CONFIRMED` at any instant**. Because nothing ever
transitions a row *away* from `CONFIRMED` (no reversal path exists, see
§4), the practical consequence — not previously stated this precisely in
any prior audit — is: **an obligation can have at most one `CONFIRMED`
payment ever, for the full lifetime of the relationship.** Once one payment
reaches `CONFIRMED`, it permanently occupies the partial index's slot, and
no further `RECORDED` or `CONFIRMED` row can ever be inserted against that
obligation. A `REJECTED` payment, by contrast, releases the slot
immediately, allowing a fresh `RECORDED` attempt.

This resolves several of the ticket's explicit questions precisely:

- **Partial payments in V1:** not supported as *concurrent* partial
  payments (only one unresolved payment may exist at a time), but a single
  `CONFIRMED` payment's `amount` is not required to equal `expectedAmount`
  — nothing in the schema enforces equality. Whether the *recording input*
  should be restricted to exactly `expectedAmount` is an open product
  decision (§10, item 2).
- **Multiple confirmed payments satisfying one obligation:** **no** — the
  schema makes this physically impossible (one `CONFIRMED` row, ever, per
  obligation).
- **Overpayment:** representable in data (nothing blocks `amount >
  expectedAmount`), and the existing member-dashboard read model already
  clamps the resulting `outstandingAmount` to zero rather than showing a
  negative figure. Whether the *recording* path should reject an
  over-amount input outright is an open decision (§10, item 2).
- **Outstanding amount:** `expectedAmount.minus(confirmedAmount)`,
  Decimal-exact, clamped to zero for display — the exact formula already
  implemented and tested in `circle-member-dashboard.service.ts`. Given the
  "at most one `CONFIRMED` ever" finding above, `confirmedAmount` in
  practice equals either the one `CONFIRMED` payment's amount or zero — a
  defensive `SUM` over any `CONFIRMED` rows remains the correct,
  future-proof way to compute it (matches the existing member-dashboard
  code exactly), even though today it will never sum more than one row.
- **When an obligation becomes `FULFILLED`:** the ledger-derived condition
  is `confirmedAmount >= expectedAmount`. This must be computed live from
  `ContributionPayment` rows.
- **Whether fulfillment is derived or persisted:** **derived, authoritatively**
  — this is the single most important carried-over finding from the 7H
  audit, restated here because it governs every accounting decision in this
  ticket sequence: `ContributionObligation.status` has no writer anywhere
  and must never be trusted as payment truth by any read model. Whether a
  *future* confirmation service should *also* write it as a denormalized
  cache is a separate, explicit open decision (§10, item 3) — not something
  to assume either way.
- **How rejected payments affect totals:** not at all. Excluded entirely
  from `confirmedAmount` by the `WHERE status = 'CONFIRMED'` filter itself,
  not filtered out after the fact.
- **Whether `RECORDED` payments count as collected money:** **no.** Only
  `CONFIRMED` does. This is the exact same rule already enforced for
  `Payout.status` in the member dashboard (`RECORDED` ≠ received) and must
  hold symmetrically here.
- **Duplicate submissions:** guarded by two independent mechanisms —
  `clientOperationId`'s per-circle uniqueness (a retried submission with
  the *same* idempotency key must be treated as already-handled, not
  re-inserted) and the partial unique index (a genuinely *new* submission
  while one is already unresolved is rejected at the database level,
  independent of any application-level check).

**Decimal arithmetic:** every existing accounting computation in this
codebase (member dashboard, activation review) uses `Prisma.Decimal`
throughout, formatting to a fixed-2 string only at the final serialization
boundary — this workflow must follow the identical discipline; no
floating-point arithmetic on money anywhere.

## 4. State-transition tables

**`ContributionPayment.status`:**

| From | To | Trigger | Terminal? |
|---|---|---|---|
| *(none)* | `RECORDED` | Owner records a contribution | No |
| `RECORDED` | `CONFIRMED` | Owner confirms | **Yes** — no further transition |
| `RECORDED` | `REJECTED` | Owner rejects | **Yes** — but a *new* `RECORDED` row may be created against the same obligation, since `REJECTED` releases the partial-index slot |

No transition originates from `CONFIRMED` or `REJECTED`. **Who may
transition:** in V1, the platform-User **owner only**, for every
transition (record, confirm, reject) — see §6. This is the opposite
direction from `Payout`'s own state machine, where the **recipient
member** confirms/disputes; contributions flow member→owner/pot, so the
owner (who, in a real susu, is the one physically collecting and verifying
contributions) is the natural party to both record and confirm them.

- **Can a confirmed payment be reversed?** No mechanism exists, and none is
  proposed for V1 (see §9's boundary discussion — a mis-confirmed payment
  is treated as a rare administrative matter, not a self-service feature,
  absent an explicit product decision otherwise).
- **Can a rejected attempt be resubmitted?** Yes — a fresh `RECORDED` row
  against the same obligation is always possible after a rejection; this
  *is* V1's resubmission mechanism (a new row, never an edit to the
  rejected one).
- **Can an obligation "reopen"?** No legitimate path — since `CONFIRMED` is
  terminal and at most one can ever exist per obligation, ledger-derived
  fulfillment can never revert from true to false once genuinely reached.
- **Can financial terms change after activation?** No — confirmed
  unchanged in this audit: nothing edits `SavingsCircle.contributionAmount`/
  `currency`, and `ContributionObligation.expectedAmount`/`currency` are
  frozen per-obligation regardless.

**`ContributionObligation.status`:** the enum permits only
`OPEN → FULFILLED`; no writer exists today for either the initial `OPEN`
value's departure or any reverse transition. Whether a future writer should
exist at all is §10, item 3 — not decided by this audit.

## 5. Round/circle eligibility matrix

| Circle status | May record? | May confirm/reject? | Notes |
|---|---|---|---|
| `DRAFT` | No | No | No obligations exist yet (created only at activation) — moot in practice. |
| `ACTIVE` | **Yes** | **Yes** | The only status where financial mutation is permitted. |
| `COMPLETED` | No | No | Not reachable today (no writer transitions to it), but must be blocked by allowlist-omission the moment it becomes reachable — matching the existing `ELIGIBLE_CIRCLE_STATUSES` pattern from `circle-member-session.service.ts`. |
| `ARCHIVED` | No | No | Same as `COMPLETED`. |
| `CANCELLED` | No | No | Not reachable today; blocked by the same deny-by-omission convention. |

| Round status | May record against its obligations? | Notes |
|---|---|---|
| `UPCOMING` | **Open decision — see §10, item 1** | Every round is `UPCOMING` forever under today's runtime (no round-lifecycle writer exists); gating recording on `ACTIVE` alone would make V1 unusable until an unscoped future ticket ships. |
| `ACTIVE` | Yes | Not currently reachable, but the natural "currently collecting" state once round lifecycle exists. |
| `CLOSED` | No (recommended) | A closed round should not accept new recordings — though whether *confirming an already-RECORDED* payment against a since-closed round should still be allowed is part of the same open decision. |

**Overdue obligations:** due dates are frozen at activation and nothing
currently marks anything overdue in any special way. **V1 should explicitly
allow recording against a past-due obligation** — a member catching up
late is normal susu behavior, not an error state; the UI may *display* it
as overdue, but eligibility to record must not depend on the due date at
all (matching the ticket's explicit "do not infer round status from due
dates").

**Interrupted/defaulting circles:** no formal "default" or delinquency
concept exists in the schema, and none is proposed here (matches §9's
explicit exclusion of automatic penalties) — V1 simply shows outstanding
amounts and takes no automatic action.

## 6. Authorization matrix

| Actor | Record | Confirm | Reject | Read (owner view) | Read (member view) |
|---|---|---|---|---|---|
| Platform User who owns the circle | **Yes** | **Yes** | **Yes** | Yes | N/A |
| Platform User who does not own the circle | No | No | No | No | N/A |
| SUSU member (member-session identity) | **No** | **No** | **No** | N/A | Yes, own obligations only (already built, 7H.2) |

V1 is explicitly an **owner-operated** workflow (ticket §6) — members
remain fully read-only for every contribution mutation; `requireCircleMember`
and the member-session system must never appear anywhere in the
recording/confirmation code path, exactly as every prior owner-facing
ticket (7I.1–7I.6) has maintained the reverse boundary.

**Every mutation must independently verify**, following the exact pattern
already established across `circle.service.ts` and `circle-draft-owner.service.ts`:
1. Authenticated platform User (`requireUser()`, at the Server Action
   boundary — never trusted from the page alone).
2. Circle ownership (`circle.ownerId === ownerId`, re-read fresh under the
   circle-row lock, not cached).
3. Circle lifecycle (`circle.status === "ACTIVE"`).
4. Obligation belongs to the circle — **structurally guaranteed**, not just
   checked: `ContributionObligation`'s compound FKs
   (`[roundId, circleId] -> [id, circleId]` on `round`,
   `[memberId, circleId] -> [id, circleId]` on `member`) make it impossible
   for an obligation to reference a round or member from a different
   circle at the database level. A service still scopes its lookup by
   `(id, circleId)` (mirroring `circle-draft-owner.repository.ts`'s
   established compound-key lookup trick) so a cross-circle `obligationId`
   simply resolves to nothing, rather than needing a separate equality
   check.
5. Member belongs to the circle — same structural guarantee via the
   compound FK.
6. Round belongs to the circle — same structural guarantee via the
   compound FK.

**May the owner record for any active member, or only a specific
round/member combination?** Given obligations already exist for every
(round, member) pair from activation, and given §5's "late/catch-up
payments allowed" direction, the answer is: the owner may record against
**any** obligation belonging to their circle that is currently ledger-`OPEN`
— not restricted to "only the current round." The service should accept an
explicit, already-known `obligationId` (never a client-reconstructed
`{roundId, memberId}` pair) and let its own circle-scoped lookup be the
sole source of truth for which round and member it resolves to — consistent
with this codebase's established preference for trusting server-verified
identifiers over client-reconstructed relationships.

## 7. Concurrency and idempotency design

**Existing primitives to reuse, unchanged:**
- `clientOperationId`, unique per `(circleId, clientOperationId)` — the
  same idempotency-key pattern already used by the `Deposit` model
  elsewhere in this codebase, not a new invention. A retried submission
  with the same key must resolve to the *existing* payment's outcome, never
  a duplicate row or an unsafe error.
- The partial unique index on `ContributionPayment(obligationId)` — a
  database-level backstop against two simultaneously-unresolved payments
  for one obligation, independent of and stronger than any application-level
  check.
- `lockSavingsCircleForUpdate` — the existing canonical lock primitive,
  reused unchanged.

**Required lock order for a new recording transaction** (mirroring exactly
the shape already used by every `DRAFT` mutation and by `activateCircle`):
1. Lock the `SavingsCircle` row (`lockSavingsCircleForUpdate`, unchanged).
2. Verify circle `ACTIVE` and ownership.
3. Look up the obligation scoped by `(id, circleId)`.
4. Verify ledger-derived `OPEN` eligibility and the absence of an existing
   unresolved payment (an application-level pre-check for a friendly error
   message; the partial index is the actual authority, exactly the
   "preflight check + atomic database guard" two-layer pattern already
   established for the activation-review fingerprint in 7I.5.1).
5. Insert the `ContributionPayment` row.

**Confirmation/rejection concurrency — the compare-and-swap pattern already
used throughout this codebase** (e.g. `markCircleActive`'s
`WHERE status = 'DRAFT'` guard, checked via the returned row count): a
confirm or reject operation should perform a conditional update —
`UPDATE ContributionPayment SET status = 'CONFIRMED', ... WHERE id = X AND
status = 'RECORDED'` — and treat an affected-row-count of zero as "this
payment is no longer pending" (a safe, generic outcome), never as a raw
error. This single mechanism resolves every race the ticket names:

- **Two confirmations of the same payment:** the second conditional update
  affects zero rows (the first already flipped `status` away from
  `RECORDED`).
- **Confirmation vs. rejection:** whichever conditional update commits
  first wins; the other affects zero rows.
- **Two payments against one obligation:** prevented by the partial unique
  index before either even reaches a confirm/reject step.
- **Contribution confirmation vs. round closure** (a future feature, not
  yet built): as long as a future "close round" operation *also* begins by
  taking the same `SavingsCircle` row lock before touching
  `PayoutRound.status` — exactly like every existing circle-scoped mutation
  already does — it is automatically serialized against any concurrent
  contribution mutation on the same circle. No new lock primitive is
  needed.
- **Contribution recording vs. any future circle lifecycle transition:**
  same answer — the single structural recommendation of this section is to
  continue the established discipline of *every* circle-scoped write
  beginning with the same `SavingsCircle` row lock, without exception, for
  every new mutation this workflow introduces.

**Client-side correctness:** restated per the ticket's explicit instruction
— disabled buttons are a UX nicety only; every guarantee above must hold
independent of anything the client does or doesn't disable, matching the
discipline already followed in every prior owner-action ticket.

## 8. Required read models / UX

Minimum owner-facing reads needed, and what can safely be reused:

| Need | Reuse? | Notes |
|---|---|---|
| Select a round | **Yes — fully reusable** | `circle-active-owner.service.ts`'s existing `rounds` list already has everything needed (`id`, `roundNumber`, `recipientDisplayName`, `recipientMemberCode`, `dueDate`, `status`). |
| See obligations for a round, across all members | **No — new read needed** | 7H.2's `findObligationsForRound` deliberately excludes member identity (privacy-appropriate for a *member's* aggregate-only progress view) and is not reusable for an owner, who legitimately needs to see *which* member owes what. A new, owner-scoped repository function is required. |
| See recorded/confirmed/rejected payment history for an obligation | **No — new read needed** | 7H.2's `findConfirmedPaymentSums` returns only an aggregated confirmed total, not row-level history with actor/timestamp/status. A new read is required to show past rejected attempts (§2's historical-preservation requirement). |
| Record a contribution (form data) | Derived from the new obligation read above | No separate read needed. |
| Confirm/reject a contribution | Derived from the new payment-history read above | No separate read needed. |
| See outstanding balances | **Formula is reusable; query is not** | The exact Decimal-safe `expectedAmount.minus(confirmedAmount)` (clamped to zero) formula from `circle-member-dashboard.service.ts` must be reused verbatim — but the owner's read needs *all* members' obligations in one round, not one member's own, so the surrounding query is new even though the math is not. |

**What can safely be reused without widening member privacy:** the pure
accounting *formulas* (confirmed-amount ledger sum, outstanding-amount
clamp, fulfilled derivation) — these are audience-agnostic math with no
privacy implication. **What must not be reused:**
`circle-member-dashboard.repository.ts`'s query functions themselves,
which are deliberately narrow (member-identity-excluding) for a *different*
audience. This is the same lesson 7I.6 already learned the hard way when
extending a shared repository's select briefly broke an existing
member-privacy test — the resolution there (build a small, parallel,
owner-scoped repository function rather than widen a member-facing one)
is the template to follow again here.

## 9. Missing services/actions/UI

None of the following exists yet; all are proposed, not built, by this
audit:

- `recordContributionPayment({ownerId, circleId, obligationId, amount, clientOperationId})`
  — new service, transactional, circle-row-locked (§7).
- `confirmContributionPayment({ownerId, circleId, paymentId})` — new
  service, conditional-update guarded (§7); **approved (§10, item 3)** to
  also write `ContributionObligation.status`/`fulfilledAt` atomically.
- `rejectContributionPayment({ownerId, circleId, paymentId, reason})` — new
  service, conditional-update guarded.
- A new owner-scoped repository: obligations-with-member-identity for a
  round; full payment history for an obligation (§8).
- Three new Server Actions wrapping the above, following the established
  `requireUser()`-first / DI-testable-core / thin-`"use server"`-wrapper
  split used by every action since 7I.1.
- ~~New Zod validation schemas for a contribution amount, a
  `clientOperationId`, and a rejection reason~~ — **built in 7J.1**, as
  `src/validations/contribution.schema.ts` (a new file, not an addition to
  `circle.schema.ts`).
- UI: a round selector (data already available), an obligation/payment list
  with record/confirm/reject controls, and an outstanding-balance display —
  none of this exists.

**V1 boundaries confirmed excluded**, matching the ticket's explicit list
and this codebase's actual runtime (none of the following has any
supporting infrastructure anywhere): real money movement, a payment
gateway, member self-recording, automatic collection, automatic penalties,
interest, loans, refunds, complex reconciliation, financial analytics, a
notification system.

**Correction/reversal mechanism:** examined explicitly per the ticket's
instruction not to silently add one. **None is proposed for V1.** A
`CONFIRMED` payment recorded in error is rare enough, and consequential
enough, that the smallest safe V1 approach is to treat it as an
administrative matter handled outside the application (direct database
correction by an operator, with the same audit trail already preserved —
nothing is ever deleted) rather than building a self-service reversal
feature whose own correctness and abuse-resistance would need its own full
design pass. If product requires a real reversal workflow, it needs its
own dedicated future ticket, explicitly out of this V1 sequence.

## 10. Decisions — APPROVED (7J.1)

All five items below were open at the end of the 7J audit and were
resolved by product-owner approval at ticket 7J.1. None is an open
decision any longer; each is now a binding V1 rule, enforced (to the
extent a domain-only ticket can enforce it) by
`src/domain/contribution-accounting.ts` and
`src/domain/contribution-state.ts`.

1. **Round eligibility for recording** (§5) — **APPROVED, and more
   permissive than either option this audit originally offered**: any
   persisted round is eligible for late/catch-up contributions, and due
   dates neither authorize nor prohibit recording. Round-level `status`
   plays no role in contribution eligibility at all — only the circle's
   own `status === "ACTIVE"` gates recording. This still needs no
   round-lifecycle ticket to ship first, and is simpler than the
   `non-CLOSED`-round compromise this audit had recommended.
2. **Overpayment handling** (§3) — **APPROVED as recommended**: a
   confirmed payment must equal the obligation's `expectedAmount`
   exactly. No partial payments, no overpayment. Enforced by the new pure
   helper `amountMatchesObligation` (`src/domain/contribution-accounting.ts`),
   which the future recording/confirmation services must call under the
   circle-row lock, comparing against the obligation's own frozen
   `expectedAmount` — never a client-supplied value (see §3 of this
   ticket's own schemas, which never accept `expectedAmount` as input).
3. **`ContributionObligation.status` as a real writer target** (§3/§9) —
   **APPROVED as recommended**: confirmation atomically marks the
   obligation `FULFILLED`, in the same transaction as the payment's own
   `CONFIRMED` write (§7's lock order). Read models must still never
   trust this column as the sole source of truth — it is a denormalized
   convenience once a real writer exists, not a replacement for deriving
   fulfillment from the ledger (see `isObligationFulfilled` in
   `contribution-accounting.ts`, still ledger-based and unchanged).
4. **Confirmed-payment reversal** (§9) — **APPROVED as recommended**: no
   reversal/correction workflow in V1. A mis-confirmed payment remains an
   administrative, outside-the-application matter. Encoded directly in
   the state contract: `CONFIRMED` has no outgoing transition in
   `src/domain/contribution-state.ts`.
5. **Mandatory rejection reason** (§2) — **APPROVED as recommended**: the
   *validation* layer requires a non-empty, ≤500-character reason, even
   though the `rejectionReason` column itself remains nullable at the
   database level. Enforced now by `rejectContributionSchema`
   (`src/validations/contribution.schema.ts`).

## Final V1 state/accounting contract (7J.1)

This section is binding, not merely descriptive — it is the contract the
7J.2+ tickets below must implement against, backed by the pure,
already-tested code in `src/domain/contribution-accounting.ts` and
`src/domain/contribution-state.ts`.

**ContributionPayment:** `RECORDED → CONFIRMED` or `RECORDED → REJECTED`,
both terminal, no reverse transition, no third option — see
`isContributionPaymentTransitionAllowed`.

**ContributionObligation:** `OPEN → FULFILLED` only, written atomically
alongside the payment's own `CONFIRMED` transition (decision #3 above) —
see `isContributionObligationTransitionAllowed`.

**Accounting:** a payment amount is valid for confirmation only if
`amountMatchesObligation(amount, obligation.expectedAmount)` is true
(exact Decimal equality). Fulfillment is `isObligationFulfilled
(confirmedAmount, expectedAmount)`, still ledger-derived and unchanged
from the pre-existing member-dashboard rule.

**Documented replay/race behavior** (`CONTRIBUTION_REPLAY_CONTRACT_KEYS`
in `contribution-state.ts`, not implemented by this ticket): duplicate
recording operation (idempotent replay via `clientOperationId`), duplicate
confirmation (safe no-op via a zero-row conditional update), duplicate
rejection (same), a confirm/reject race (first commit wins, the loser
observes zero affected rows), a fresh attempt after rejection (a new row
is expected and permitted), and recording against an already-fulfilled
obligation (rejected — and, incidentally, already backstopped by the
partial unique index itself, since it covers `CONFIRMED` as well as
`RECORDED`).

**Validated, non-authoritative input contract:**
`recordContributionSchema` / `confirmContributionSchema` /
`rejectContributionSchema` (`src/validations/contribution.schema.ts`)
accept only `obligationId`/`paymentId`, `amount`, `clientOperationId`, and
`rejectionReason` — never `ownerId`, `status`, any actor ID, any
timestamp, `currency`, or `expectedAmount`. Ownership and identity come
only from `requireUser()` at the future Server Action boundary; the
frozen `expectedAmount` is read fresh from the database by the future
service, under lock, never trusted from the client.

**Historical payment state vs. current obligation state (7J.4.1
correction).** A subtle but important distinction, discovered only once
both `confirmContribution` (7J.3) and `rejectContribution` (7J.4) existed
together: a `ContributionPayment`'s own historical validity must never be
gated on its obligation's *current* status, because the two are allowed to
diverge over time in one specific, entirely legitimate way:

```
Payment A RECORDED
  → Payment A REJECTED                 (A is now permanent history)
  → Payment B RECORDED                 (fresh attempt, new row, new clientOperationId)
  → Payment B CONFIRMED                (B fulfills the obligation)
  → Obligation FULFILLED
```

At the end of this sequence, Payment A is still, correctly, `REJECTED` —
and replaying that rejection (an owner re-submitting the same rejection
form, or a retried request) must still succeed, even though the
obligation it was once attached to is no longer `OPEN`. The original
`resolveRejectedReplay` implementation required `obligation.status ===
"OPEN"` as part of its replay-consistency check, which made this
legitimate replay incorrectly fail as an "integrity conflict" the moment
a *different* payment on the same obligation was later confirmed.

The corrected rule, implemented in `contribution-rejection.service.ts`:
a `REJECTED` payment's replay validity depends only on **its own row's**
internal consistency (rejection provenance complete: `rejectedAt` /
`rejectedById` / `rejectionReason` all present; no contradictory
confirmation provenance on that *same* row, since a real payment is
terminal in exactly one direction; its frozen `amount`/`currency` still
agreeing with the obligation's own frozen `expectedAmount`/`currency`,
which never change with fulfillment) plus a narrower, direction-agnostic
sanity check on the obligation (`FULFILLED` must carry a non-null
`fulfilledAt`; `OPEN` must carry a null one) — never on which of the two
legitimate obligation states currently holds. The same distinction applies
symmetrically to `resolveConfirmedReplay` in
`contribution-confirmation.service.ts`, though no bug was found there:
a `CONFIRMED` payment's own obligation genuinely must be `FULFILLED`
(the partial unique index guarantees at most one `CONFIRMED` payment ever
exists per obligation, so a confirmed payment's obligation has no
legitimate "OPEN, fulfilled by someone else later" case to account for —
unlike a rejected payment, which by design yields the obligation to a
possible successor).

## 11. Proposed narrow ticket sequence

Ticket 7J.1 (this ticket) is **COMPLETE** and occupies the first slot
below — the sequence originally proposed by the 7J audit is renumbered
accordingly. Nothing past 7J.1 is implemented yet.

- **7J.1** — ✅ **COMPLETE.** Contribution domain contract: validation
  schemas (`src/validations/contribution.schema.ts`), shared Decimal
  accounting helpers (`src/domain/contribution-accounting.ts`), and the
  state-transition contract (`src/domain/contribution-state.ts`) — no
  service, repository, action, or UI.
- **7J.2** — Contribution recording service (`recordContributionPayment`)
  + the owner-scoped repository reads it needs (§8), circle-row-locked,
  built directly on 7J.1's schemas and helpers.
- **7J.3** — Contribution recording Server Action (thin wrapper).
- **7J.4** — Contribution confirmation/rejection service
  (`confirmContributionPayment` + `rejectContributionPayment`), the
  conditional-update concurrency guard from §7, and the `FULFILLED` write
  now approved as decision #3.
- **7J.5** — Confirmation/rejection Server Actions.
- **7J.6** — Owner round/obligation/payment read model (the remaining
  repository + service gap identified in §8: obligations-with-member-identity
  for a round, and full payment history for an obligation).
- **7J.7** — Owner contribution-recording UI (round selector, obligation
  list, record control).
- **7J.8** — Owner confirmation/rejection UI (payment list with
  confirm/reject controls, rejection-reason input, outstanding-balance
  display).
- **7J.9** — Live concurrency verification for the record/confirm/reject
  races identified in §7 and enumerated in `CONTRIBUTION_REPLAY_CONTRACT_KEYS`,
  mirroring 7I.5.1's own dedicated concurrency-guard ticket.

## Verification

- No application code changed.
- No schema or migration changed.
- No test changed.
- This document is the only artifact produced.

**TICKET 7J — CONTRIBUTION WORKFLOW DOMAIN AUDIT: COMPLETE**
