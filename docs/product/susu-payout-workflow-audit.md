# SUSU Payout Workflow — Domain Audit (7K)

Status: AUDIT ONLY, plus a documentation-only sign-off. No application
code, schema, migration, or test has been changed to produce this
document at any point. It establishes what the existing persistence
layer already guarantees for payouts, defines the V1 business flow and
state machine, and proposes a narrow implementation sequence — mirroring
the methodology of `docs/product/susu-contribution-workflow-audit.md`
and `docs/product/phase-7j-contribution-workflow-freeze.md` for the
sibling contribution workflow.

**7K.1 update:** every question this audit originally left open (§18)
has since been resolved by explicit product/architecture sign-off. See
the **"V1 Signed-Off Contract — 7K.1"** section immediately below for the
binding, authoritative decisions. The rest of this document is left
intact as the reasoning that produced those decisions — sections that
originally described a choice as "open," "recommended," or "not yet
binding" are annotated in place to point back at the sign-off rather
than rewritten, per the instruction not to erase useful audit reasoning.

Every claim below is sourced from direct reads of `prisma/schema.prisma`,
the migration SQL in
`prisma/migrations/20260908225541_susu_v1_persistence_contract/`,
`src/services/circle.service.ts` (`activateCircle` and its repository
calls in `src/repositories/circle.repository.ts`),
`src/repositories/circle-lock.repository.ts`,
`src/services/circle-member-dashboard.service.ts` and its repository,
`src/services/circle-active-owner.service.ts`,
`src/auth/require-circle-member.ts`, and a codebase-wide grep for every
write site touching `Payout`/`PayoutRound` — not reconstructed from
ticket descriptions or assumed from the contribution workflow's shape.

## V1 Signed-Off Contract — 7K.1

**This section is binding.** It resolves every question §18 originally
left open, plus the narrower confirmations that section flagged as P2.
Every payout writer built from this point forward must conform to it.
Where a decision below matches this audit's own original recommendation
(§5–§9), that is noted; nothing here silently contradicts the reasoning
already on record — it is that reasoning, now made authoritative.

**1. Payout amount authority.** Frozen:

```
expectedPayoutAmount(round) =
  SUM(ContributionObligation.expectedAmount for that persisted round)
```

The `ContributionObligation` rows created at activation are the
historical authority (§5). Payout amount must **never** be derived from
the current `CircleMember` count, current `payoutOrder`, or
`circle.contributionAmount × live membership count` — only from the
frozen obligation rows themselves. All obligations for a round must
carry a consistent `currency`; a future payout writer must **reject**
that integrity inconsistency outright (a new, explicit error) rather
than silently compute around corrupted obligation history. No schema
migration is implied or required.

**2. Payout state machine.** Frozen:

```
(no payout) -> RECORDED -> CONFIRMED   (terminal)
                         -> DISPUTED    (terminal)
```

**Option A from §6 is adopted as binding.** `CONFIRMED` and `DISPUTED`
are both terminal. No transition exists for: `CONFIRMED → DISPUTED`,
`DISPUTED → CONFIRMED`, `DISPUTED → RECORDED`, payout deletion/reset, a
replacement payout row, an owner override, or any reversal/correction
workflow. `Payout`'s existing full `@@unique([roundId])` constraint is
confirmed **intentional for V1**: one permanent payout record per round,
for the life of that round. A `DISPUTED` payout is therefore an
unresolved historical outcome that **blocks** normal settlement/round
closure (§8) rather than something a future writer rewrites or replaces.
**No schema migration** — Option B from §6 is explicitly declined for
V1.

**3. Owner recording eligibility.** Frozen: the owner may record a
payout for **any persisted round** while the `SavingsCircle` is
`ACTIVE`. Recording must **not** require `PayoutRound.status ===
ACTIVE`, the round's `dueDate` having been reached, all of that round's
obligations being `FULFILLED`, contributions being confirmed, or any
prior recipient action. Rationale, confirmed as binding: `recordPayout`
records an external fact that already occurred; NIA is not authorizing
or executing the transfer, so gating the recording of an
already-occurred event protects nothing real (§7's own reasoning,
adopted unchanged). The service must still independently enforce:
authenticated/trusted owner (`requireUser()`), fresh ownership, `ACTIVE`
circle, a persisted same-circle round, the exact authoritative
payout amount/currency (item 1 above), one payout per round, and the
idempotency/integrity rules in item 6 below.

**4. Recipient authority.** Frozen: only the persisted
`PayoutRound.recipientId` may confirm or dispute that round's payout.
Identity comes **exclusively** from `requireCircleMember(circleId)` —
never from any recipient/member identifier in a request payload. The
owner cannot confirm for the recipient, dispute for the recipient, or
override the recipient's decision. No other circle member — including
a different round's own recipient — may act on a payout that isn't
theirs.

**5. Dispute contract.** Frozen: `disputeReason` is **required and
non-empty** (§9's recommendation, now binding — mirrors
`rejectContributionSchema`'s own approved rule). Meaning, fixed exactly:
*"The recipient reports that this payout was not validly received."*
NIA records the dispute; **NIA does not adjudicate it or determine
where the money is.** The original recorded `amount`, `currency`, owner
actor (`recordedById`), `recordedAt` timestamp, and `clientOperationId`
remain immutable after a dispute — dispute only ever adds
`disputedByMemberId`/`disputedAt`/`disputeReason`, never touches
anything recorded earlier.

**6. Idempotency / replay.** Frozen, exactly as proposed in §10:
- Owner recording: same `clientOperationId` + same round/amount intent
  → safe replay. Same `clientOperationId` + different intent → intent
  conflict. A payout already recorded for that round under a
  **different** operation id → an "already-recorded" conflict (distinct
  from an intent conflict — the round's single slot is simply occupied).
- Confirmation: `CONFIRMED` + internally consistent provenance → safe,
  zero-write replay.
- Dispute: `DISPUTED` + the exact same reason + consistent provenance →
  safe, zero-write replay. `DISPUTED` + a different reason → intent
  conflict.
- No replay path may ever regenerate a timestamp or actor provenance
  field — every replay returns the row's original, first-written
  values.

**7. Historical authority.** Frozen ownership of historical fact, per
entity: `PayoutRound` owns round identity, `recipientId`, `dueDate`, and
`roundNumber`. `ContributionObligation` rows own activation-time
contribution amounts, currencies, and cohort participation for the
round. `Payout` owns the actually-recorded payout amount/currency, its
`clientOperationId`, owner recording provenance, the recipient's
terminal decision provenance, and the dispute reason. None of these
facts may ever be reconstructed from current member order or any
mutable presentation state.

**8. Round lifecycle.** Frozen: `PayoutRound.status`
(`UPCOMING → ACTIVE → CLOSED`) is kept as a distinct
**workflow/presentation lifecycle**, explicitly separated from
**financial mutation authorization**. Neither payout recording nor
contribution recording is gated by `PayoutRound.status` (item 3 above;
§7 of the contribution freeze doc). The intended settlement meaning is
frozen as: **a round may become `CLOSED` only when every persisted
`ContributionObligation` for that round is `FULFILLED` AND the round's
`Payout` is `CONFIRMED`.** A merely-`RECORDED` payout is insufficient; a
`DISPUTED` payout can never close the round (item 2 above). **These
transitions are explicitly not implemented by any 7K payout-writer
ticket** — round activation/closure orchestration is deferred to a
separate lifecycle slice, built after payout mutations exist.

**9. `ACTIVE` round meaning.** Frozen: `ACTIVE` remains a meaningful,
retained value of `PayoutRoundStatus` in V1 — it represents the current
rotation/turn for owner orientation, member orientation, and dashboard
presentation. It does **not** mean "only this round may receive
financial bookkeeping." `PayoutRoundStatus` is not removed or collapsed.
This resolves Unresolved Question #2 (§18) in the "display/organizational
concept" direction §12 already anticipated as the likely answer.

**10. Circle completion.** Not implemented here (still true). The
intended eventual rule is frozen as documentation only: **circle
completion requires every round to be `CLOSED`.** Because `CLOSED`
itself already requires every obligation `FULFILLED` and the payout
`CONFIRMED` (item 8), those two financial predicates do not need to be
duplicated as independently-checked completion authority if round
closure is implemented correctly — and a `DISPUTED` payout therefore
already prevents both its round from closing and, transitively, normal
circle completion. **This reduction must be re-audited when circle
completion is actually implemented, not assumed correct from
documentation alone** — carried forward verbatim from §13's own caveat,
because implementation-time reality (e.g., exactly how "every round" is
computed) could surface an edge case this document hasn't seen.

**11. V1 non-goals.** Frozen, unchanged from §17, restated here for
completeness since sign-off is the section future tickets will check
first: payout correction/reversal, a second payout attempt after
dispute, dispute adjudication, owner override, replacement recipient,
partial payout, split payout, refund, redistribution, escrow, NIA-held
money, payment gateway, mobile-money execution, bank-transfer execution,
automated collection, automated payout, penalties, interest, loans.

**Resolution of every §18 item**, for direct traceability:

| # | Question | Resolution |
|---|---|---|
| 1 | `DISPUTED` terminality — Option A or B? | **Option A**, binding (item 2 above). No migration. |
| 2 | Does anything gate on `PayoutRound.status` reaching `ACTIVE`? | **No** — `ACTIVE` is display/orientation-only in V1 (item 9 above). |
| 3 | Owner recording eligibility — confirm the permissive default? | **Confirmed**, binding (item 3 above). |
| 4 | `disputeReason` required or optional? | **Required**, binding (item 5 above). |
| 5 | Denormalize the round's expected payout amount? | Still deferred, P3 — not part of this sign-off; §5's derivation (item 1 above) remains authoritative until/unless a real performance need is demonstrated. |

None of these remain open. §18 below is retained as the original
reasoning trail and is now annotated accordingly rather than rewritten.

## 1. Persistence audit — what already exists

**Schema models (all exist, migrated):** `SavingsCircle`, `CircleMember`,
`CircleMemberSession`, `PayoutRound`, `ContributionObligation`,
`ContributionPayment`, `Payout`.

**Confirmed to have zero runtime writer anywhere in `src/`:** nothing
creates or mutates a `Payout` row (a codebase-wide grep for
`.payout.create`/`.update`/`.updateMany`/`.upsert` outside migrations and
tests returns zero results), and nothing transitions `PayoutRound.status`
away from its `UPCOMING` default (zero `payoutRound.update*` call sites
anywhere). This restates and extends the 7H/7J audits' own finding: SUSU
round/obligation *scheduling* is fully materialized at activation, but
neither the payout ledger nor the round lifecycle has a writer yet.

**What activation already guarantees, precisely** (`activateCircle`,
`circle.service.ts:539-647`, plus `circle.repository.ts`'s
`createCircleActivationRounds`/`createCircleActivationObligations`):

- One `PayoutRound` per ACTIVE member at activation time, `roundNumber`
  = that member's `payoutOrder` (1..N), `recipientId` = that member,
  `dueDate` = `roundDueDate(circle, roundNumber)` (frozen, computed once).
  Every round is created `status: "UPCOMING"`, `activatedAt: null`,
  `activatedById: null`. **No round is ever created ACTIVE.**
- One `ContributionObligation` per **(round, member)** pair — every
  member, including a round's own recipient, owes a contribution in
  every round (`obligations: generatedRounds.flatMap((round) =>
  members.map((member) => ({ roundId: round.id, memberId: member.id,
  ... })))`), giving exactly `N²` obligations for `N` members. This is
  the load-bearing fact behind §5 below.
- `assertActivatedRotationIntegrity` independently re-verifies, on every
  subsequent read of an already-ACTIVE circle, that this shape still
  holds (`rounds.length === members.length`, `obligations.length ===
  members.length ** 2`, every round has exactly one obligation per
  member, every obligation's `expectedAmount`/`currency` matches the
  circle's own frozen terms) — a defensive, always-on structural
  guarantee, not a one-time check.
- Post-activation membership is immutable: `removeDraftCircleMember`
  (via `assertDraftOwner`) rejects any circle that is not `DRAFT`. **No
  writer anywhere can add or remove a member from an ACTIVE circle.**
  This means, for V1, the "current ACTIVE member count" and "the
  activation-time cohort size" can never diverge — but see §5 for why
  this codebase's own convention is to still prefer the frozen
  historical source over a live count.

**Locking:** `lockSavingsCircleForUpdate` (`SELECT ... FOR UPDATE` on
`SavingsCircle`) remains the one shared serialization primitive, used
unchanged by every DRAFT mutation, `activateCircle`, and all three
contribution writers. Nothing yet locks at round or payout granularity —
none has been needed, since nothing writes at that granularity yet.

**Member-session infrastructure (`src/auth/require-circle-member.ts`,
built in 7G.3/7G.4):** `requireCircleMember(circleId)` returns
`{circleId, memberId}` derived **only** from the validated
`CircleMemberSession` — there is no `memberId` parameter for a caller to
supply. It already re-verifies, on every call, against fresh database
state: session unexpired/unrevoked, `credentialVersion` still matches,
member status `ACTIVE`, circle status one of `ACTIVE`/`COMPLETED`/
`ARCHIVED`, and that the session's own `circleId` matches the one being
requested. This is the exact primitive a future recipient
confirm/dispute action needs, structurally identical in shape to
`requireUser()` for owner actions — no infrastructure gap exists here.

**Existing read models relevant to this workflow:**
- `circle-member-dashboard.service.ts` (7H.2) already reads the
  recipient's own payout via `findPayoutForRound(roundId)` — a strict
  `prisma.payout.findUnique({ where: { roundId } })` 1:1 lookup backed by
  the schema's own `@@unique([roundId])` — returning `amount`, `status`,
  `recordedAt`, `confirmedAt`, `disputedAt` (no actor IDs, no
  `disputeReason`). Crucially, this is only ever queried when
  `recipientRound` (the round where *this* member is recipient) exists —
  a non-recipient member's dashboard never queries any `Payout` row at
  all, for any round. **The "a member cannot see another member's
  payout" privacy boundary already exists today, by construction, on the
  read side** (§14 is about extending it, not establishing it).
- `circle-active-owner.service.ts` (7I.6) carries **no** payout data —
  explicitly out of that ticket's scope, confirmed unchanged since.

**Do not assume persistence implies workflow:** restated once more,
because it is the single fact every section below depends on —
`Payout` and the full `PayoutRoundStatus` lifecycle exist, fully
indexed and constrained, with **zero** application code that writes to
either.

## 2. Existing `Payout` model — audited field-by-field

Confirmed directly from `prisma/schema.prisma:403-432` (not assumed):

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id` | |
| `circleId` | `String` (FK → `SavingsCircle`) | |
| `roundId` | `String` (compound FK → `PayoutRound(id, circleId)`) | |
| `amount` | `Decimal @db.Decimal(18,2)` | |
| `currency` | `String @db.Char(3)` | |
| `status` | `PayoutStatus @default(RECORDED)` | enum: `RECORDED`, `CONFIRMED`, `DISPUTED` |
| `clientOperationId` | `String` | |
| `recordedAt` | `DateTime @default(now())` | |
| `recordedById` | `String` (FK → `User`) | the **owner**, a platform User |
| `confirmedAt` | `DateTime?` | |
| `confirmedByMemberId` | `String?` (compound FK → `CircleMember(id, circleId)`) | the **recipient**, a `CircleMember` |
| `disputedAt` | `DateTime?` | |
| `disputedByMemberId` | `String?` (compound FK → `CircleMember(id, circleId)`) | the **recipient**, a `CircleMember` |
| `disputeReason` | `String? @db.VarChar(500)` | |
| `createdAt`/`updatedAt` | `DateTime` | ORM bookkeeping only |

This list matches the ticket's assumed shape exactly — no field is
missing or misnamed, and the actor-type split is deliberate and already
correct: `recordedById` references `User` (the owner, platform
identity), while `confirmedByMemberId`/`disputedByMemberId` reference
`CircleMember` (the recipient, member-session identity) — mirroring
`ContributionPayment`'s own `recordedById: User` /
`confirmedById: User` split, except here the confirming/disputing party
is structurally a *member*, not a *User*, which is exactly right for
this workflow's cross-identity-system shape (owner records, recipient
member responds).

**Uniqueness audit:**

- `@@unique([roundId])` — **one `Payout` row per round, full stop, for
  the entire lifetime of that round.** This is a plain unique index, not
  a partial one (confirmed in the migration SQL: `CREATE UNIQUE INDEX
  "Payout_roundId_key" ON "Payout"("roundId");`, no `WHERE` clause). This
  is a materially different shape from `ContributionPayment`'s own
  `@@unique([circleId, clientOperationId])` **plus** a *separate partial*
  unique index scoped to `WHERE status IN ('RECORDED','CONFIRMED')` that
  deliberately excludes `REJECTED`. `Payout` has no such partial index —
  a `DISPUTED` payout permanently occupies its round's one slot, exactly
  as a `CONFIRMED` one would. **This is the single most consequential
  persistence fact in this audit — see §6.**
- `@@unique([circleId, clientOperationId])` — the same circle-scoped
  idempotency-key shape already used by `ContributionPayment` and
  `Deposit`. Reusable unchanged for owner recording replay (§10).
- Same-circle FK integrity: `Payout.roundId` is a **compound** FK to
  `PayoutRound(id, circleId)`, so a `roundId` belonging to a different
  circle simply cannot be inserted — structurally impossible, not just
  application-checked, identical to every other SUSU financial FK in
  this schema. Likewise `confirmedByMemberId`/`disputedByMemberId` are
  compound FKs to `CircleMember(id, circleId)`, structurally guaranteeing
  the confirming/disputing member belongs to the same circle as the
  payout — but **not** that they are specifically the round's recipient;
  that check is not, and cannot be, expressed as a database constraint
  and must be an explicit application-level check (§8).
- **Recipient relationship authority**: `PayoutRound.recipientId` is the
  single, already-frozen source of truth for "who should be paid this
  round," fixed at activation (`@@unique([circleId, recipientId])` also
  guarantees no member can be the recipient of two different rounds).
  `Payout` does not duplicate a recipient reference of its own — it is
  reached transitively via `roundId → PayoutRound.recipientId`. This is
  correct and requires no denormalization: the round's recipient is
  exactly as immutable as everything else established at activation
  (§4).

## 3. V1 business flow — is it fully supported by current persistence?

**Yes, structurally**, with one explicit, load-bearing design decision
required first (§6): the flow "owner records externally-made payout →
recipient sees it → recipient confirms or disputes" maps cleanly onto
`Payout.status: RECORDED → CONFIRMED` or `RECORDED → DISPUTED`, exactly
mirroring the contribution ledger's own owner-records/counterparty-
responds shape, with the actor roles reversed (owner records *outbound*
money leaving the pot; for contributions, the owner also records but the
member is the one who *paid in*, not received). "NIA tracks; NIA does
not hold or move money" is already the established framing for
contributions and requires no new schema concept to carry over verbatim
for payouts — no escrow/gateway field exists anywhere in this schema,
by design.

The one open question this flow surfaces, not yet answered by
persistence alone, is what happens after a `DISPUTED` outcome — covered
fully in §6.

## 4. Historical authority

**"What historical information must payout operations preserve?"**

- **Round identity and recipient** — `PayoutRound.id` /
  `PayoutRound.recipientId`, frozen at activation, immutable forever
  (no writer can change a round's recipient). A payout is always
  reached via `roundId`; the recipient is never re-derived from current
  `payoutOrder` or current member data.
- **Payout amount and currency** — `Payout.amount`/`currency`, set once
  at recording. Never edited after creation (no writer exists that would
  update them, and none is proposed — see §6).
- **Operation identity** — `clientOperationId`, unique per
  `(circleId, clientOperationId)`, guarding a retried owner submission
  from becoming a duplicate row (the schema does not need a *second*
  guard the way `ContributionPayment` does, because `@@unique([roundId])`
  already makes a duplicate row for the same round impossible at the
  database level regardless of operation id — see §6/§10).
- **Owner recording actor and timestamp** — `recordedById`/`recordedAt`.
  Immutable once set.
- **Recipient confirmation actor and timestamp** —
  `confirmedByMemberId`/`confirmedAt`, **or** recipient dispute actor,
  timestamp, and reason — `disputedByMemberId`/`disputedAt`/
  `disputeReason` (mutually exclusive, set exactly once, on the single
  transition out of `RECORDED`). Immutable once set — no code path
  should ever clear or reassign either pair.
- **Round identity / circle identity** — carried structurally via the
  compound FKs (`roundId → PayoutRound(id, circleId)`), never
  independently re-derivable and never needing independent storage.

**Do not reconstruct past payout facts from current `payoutOrder`,
current member data, or current dates when persisted history exists:**
concretely, a future payout read model must resolve "who was this
round's recipient" from `PayoutRound.recipientId` (frozen), never from
"whichever member currently has `payoutOrder = roundNumber`" — even
though, today, those two things can never actually disagree (membership
is immutable post-activation, per §1), the persisted round relationship
is still the authoritative source, exactly matching the discipline
`circle-active-owner.service.ts`'s own doc comment already states for
round rendering ("recipientId, never re-derived from 'whichever member
currently has payoutOrder=N'").

**Immutable facts, restated as a rule:** everything on `PayoutRound`
(identity, recipient, due date) once created; everything on a `Payout`
row once created, **except** its own `status` and the one corresponding
actor/timestamp/reason pair, set exactly once on the single permitted
transition out of `RECORDED` — identical in shape to
`ContributionPayment`'s own immutability rule (§2 of the sibling
contribution freeze doc).

## 5. Authoritative payout amount — critical audit question, resolved

**The V1 payout amount for round R is `SUM(ContributionObligation.expectedAmount
WHERE roundId = R)`, which is exactly `circle.contributionAmount ×
(the activation-time ACTIVE cohort size)` — and this is already safely
derivable from frozen, immutable persistence. No schema change is
required.**

Reasoning, precisely:

- Every round gets exactly one `ContributionObligation` per member
  (§1) — **including the round's own recipient**, who also owes a
  contribution in their own payout round, exactly like every other
  member. So a round with `N` obligations, each frozen at
  `expectedAmount = circle.contributionAmount` (verified by
  `assertActivatedRotationIntegrity`'s own check that every obligation's
  `expectedAmount` still equals the circle's frozen
  `contributionAmount`), sums to `N × contributionAmount` — precisely
  the "pot" a susu round is supposed to produce.
- These obligation rows are created exactly once, at activation, and
  nothing in this codebase (per the exhaustive writer grep in §1) ever
  adds, removes, or edits one afterward. Summing them for a given
  `roundId` is therefore querying **frozen historical fact**, not a live
  recomputation — the same "sum over immutable rows" pattern the
  contribution accounting formula (`confirmedAmount`, in
  `contribution-accounting.ts`) already uses, just summing
  `expectedAmount` instead of `amount`.
- The ticket's own caution — "do not calculate from the current live
  cohort if membership can differ from activation history" — is
  correctly heeded by preferring the obligation-sum over, say, `COUNT(*)
  FROM CircleMember WHERE circleId = X AND status = 'ACTIVE'`. Today,
  under V1's actual runtime (no post-activation membership mutation
  exists at all), the two would always agree — but the obligation-sum
  remains the right choice on principle, because it is anchored to the
  specific round's own frozen obligation set rather than to "whatever
  the live member table says right now," and would continue to be
  correct even if a future ticket ever needed to represent a
  membership change mid-circle (not currently possible, and not
  proposed here).
- This value is **not** currently denormalized onto `PayoutRound` itself
  (no `expectedAmount`/`payoutAmount` column exists there). That is a
  reasonable, deliberate omission for V1: the value is trivially and
  safely derivable via one indexed query
  (`ContributionObligation_circleId_roundId_status_idx` already covers
  `(circleId, roundId, ...)`), so adding a denormalized column would be
  a P3 convenience at most, never a P0/P1 correctness requirement.

**Conclusion for §19 classification: not a blocker.** The payout amount
is safely derivable from frozen activation facts today; no migration is
needed before the first payout writer.

**Integrity requirement, made explicit at 7K.1 sign-off:** every
obligation summed for a round must carry the same `currency` (already
guaranteed in practice by `assertActivatedRotationIntegrity`'s own
check that every obligation's `currency` matches the circle's frozen
`currency`, per §1). A future `recordPayout` service must **reject**
outright — with a new, specific integrity error, never a silent
best-effort sum — if it ever observes a round's obligations disagreeing
on currency, rather than calculating around what would then be corrupted
history. This is a defensive backstop for a state the current writers
cannot actually produce, not a response to an observed defect.

## 6. Payout state machine — resolved 7K.1 (see sign-off, item 2)

**Proposed transitions**, matching the ticket's own proposal and the
`PayoutStatus` enum's own three values:

```
(no Payout row) -> RECORDED -> CONFIRMED   (terminal)
                             -> DISPUTED    (terminal? -- see below)
```

**`CONFIRMED` is unambiguously terminal.** No product reason and no
schema affordance exists for un-confirming a payout — mirrors
`ContributionPayment.CONFIRMED`'s own terminality exactly (§4 of the
contribution freeze doc: "no reversal/correction workflow in V1").

**`DISPUTED`'s terminality is forced by the schema, not merely a design
preference — and this is the audit's central finding.** Because
`Payout.@@unique([roundId])` is a **full**, not partial, unique index
(§2), there is **no way to insert a second `Payout` row for the same
round after a `DISPUTED` one**, structurally unlike
`ContributionPayment`, where a `REJECTED` row releases its partial
index's slot and a fresh `RECORDED` attempt is always possible. **A
disputed payout cannot be corrected or re-recorded under the current
schema — not via a new row, and (absent a reversal feature this ticket
explicitly disfavors) not via editing the existing row either.**

This forces an explicit choice, presented as the audit's primary
decision for product/architecture sign-off before any writer is built:

- **Option A (recommended, no schema change):** `DISPUTED` is a
  permanent, terminal historical fact for that round. A dispute is an
  administrative matter resolved outside the application (the owner and
  recipient reconcile in person; a corrected record, if ever needed, is
  a direct database operation performed by an operator — not a
  self-service in-app feature) — this is the **exact same posture**
  already adopted and product-approved for a mis-confirmed
  `ContributionPayment` (7J audit §9, reaffirmed in the 7J freeze
  document). Consequence: a `DISPUTED` payout permanently blocks that
  round's own closure under the proposed round-lifecycle rule (§12),
  and therefore permanently blocks circle completion under the proposed
  completion rule (§13), unless a future ticket introduces some
  narrowly-scoped administrative override — not proposed here.
- **Option B (requires a migration):** replace `@@unique([roundId])`
  with a circle-scoped `clientOperationId` unique constraint plus a
  *separate partial* unique index (`WHERE status IN ('RECORDED',
  'CONFIRMED')`), mirroring `ContributionPayment`'s exact shape, so a
  fresh `RECORDED` attempt becomes possible against the same round after
  a `DISPUTED` one. This is a real, buildable option — but it is a
  **schema change**, explicitly out of this audit ticket's scope
  ("Do not silently alter the schema in this ticket"), and changes the
  round-closure question in §12 nontrivially (closure would then need to
  wait for the *latest* payout attempt per round, not merely "the"
  payout).

**RESOLVED (7K.1): Option A is adopted, binding, no schema migration.**
This was originally flagged here as Unresolved Architecture Question #1
(§18), P1 — it no longer is. See the "V1 Signed-Off Contract" section
above, item 2, for the binding statement; the reasoning below is
retained unchanged as the analysis that produced that decision.

**The remaining sub-decisions the ticket asks for, answered under
Option A (now the binding rule, not merely the recommended default):**

- Can a disputed payout be corrected/re-recorded in-app? **No** (Option
  A) / Yes, via a fresh row (Option B, needs migration).
- Can dispute return to `RECORDED`? **No** — no transition out of
  `DISPUTED` in either option; a fresh attempt (Option B only) would be
  a **new** row, never a resurrection of the disputed one, exactly
  mirroring `REJECTED`'s own "history preserved, never reused" rule for
  contributions.
- Can the owner override a dispute? **No** — the owner never writes
  `confirmedByMemberId`/`disputedByMemberId`/`status` directly; only the
  recipient's own confirm/dispute action does, matching the existing
  cross-identity-system discipline (owner and member never share a
  mutation path).
- Can the recipient change `CONFIRMED` → `DISPUTED` or vice versa?
  **No** — both are terminal for the one `Payout` row that exists; a
  recipient does not get a "change my mind" path any more than a
  contribution's confirmer does.

## 7. Owner recording authority — resolved 7K.1 (see sign-off, item 3)

**Explicit decision, binding as of 7K.1:** an owner may record a payout for **any
persisted round belonging to their ACTIVE circle, regardless of that
round's own `status` (`UPCOMING`/`ACTIVE`/`CLOSED` all eligible) and
regardless of whether that round's obligations are fulfilled** —
deliberately mirroring the contribution workflow's own permissive
philosophy (7J.1 decision #1: round status and due dates neither
authorize nor prohibit contribution recording), but arrived at
independently, not by blind analogy, for this reason: **recording is
capturing a fact that already happened outside NIA.** NIA has no
mechanism to prevent an owner from physically handing over a round's
pot early or late in the real world; gating the *recording* of that
already-occurred event would not protect anything real — it would only
make NIA's own ledger diverge further from reality while the owner
waits for some in-app precondition to clear. This is the same reasoning
that justified permissive contribution recording, applied to the
payout side of the same ledger.

**RESOLVED (7K.1):** this was originally presented as a recommended
default requiring explicit product-owner confirmation before being
treated as binding (matching the 7J.1 precedent for the analogous
contribution-recording decision) — it has since been confirmed exactly
as recommended, with no changes. See the "V1 Signed-Off Contract"
section above, item 3.

**What recording must still verify independently, regardless of the
round-eligibility answer above** (identical in shape to every existing
owner mutation):
1. `requireUser()` at the Server Action boundary.
2. Fresh circle ownership + `status === "ACTIVE"`, re-checked under the
   circle-row lock.
3. The round belongs to this circle (`(id, circleId)`-scoped lookup —
   structurally guaranteed, not just checked, via `PayoutRound`'s own
   compound FKs).
4. No `Payout` row already exists for this round (the partial-or-full
   unique index is the ultimate backstop; a friendly preflight check is
   still worth doing for a clear error message, mirroring
   `contribution-recording.service.ts`'s own two-layer pattern).

## 8. Recipient confirmation authority

Fully supportable by existing member-session infrastructure (§1), with
these explicit rules:

- **Only the persisted `PayoutRound.recipientId` may confirm.** This is
  **not** automatically true just because `requireCircleMember` succeeds
  — that primitive proves "this session belongs to *some* active member
  of this circle," not "this member is *this round's* recipient." The
  future `confirmPayout` service must independently compare
  `identity.memberId === round.recipientId` and reject otherwise — the
  same shape as `confirmContribution`'s own independent ownership
  re-check, just against a different authority column.
- **Membership must match authenticated `CircleMember` identity**:
  `requireCircleMember(circleId)` already derives `memberId` only from
  the validated session, never from client input — there is nothing for
  a forged `memberId` to override.
- **`circleId` must match the member session**: already enforced inside
  `requireCircleMember` itself (the "session's own trusted circleId
  matches the circleId being requested" check documented in its own
  code comment) — no additional work needed.
- **The recipient must remain historically authorized even if other
  mutable member fields later change**: since `PayoutRound.recipientId`
  is frozen at activation and no writer can ever change a round's
  recipient, this is automatically true — there is no "recipient
  reassignment" feature to guard against, because none exists or is
  proposed (§17).
- **The owner cannot confirm on the recipient's behalf**: structurally
  true today by omission — no code path lets a platform User write
  `confirmedByMemberId`, and the future service must keep it that way
  (own-identity-only, exactly like `confirmContribution` never accepting
  an owner-supplied member identity as authoritative).

**Conclusion: current member-session infrastructure supports this
without identity ambiguity.** No new primitive is needed — only a new
service that calls the existing `requireCircleMember` and adds one
recipient-match check on top.

## 9. Dispute authority — `disputeReason` resolved 7K.1 (see sign-off, item 5)

- **Only the persisted recipient may dispute** — identical reasoning and
  identical required check as §8 (`identity.memberId === round.recipientId`).
- **`disputeReason` is required, not optional — RESOLVED (7K.1),
  binding.** Originally recommended here, mirroring
  `rejectContributionSchema`'s own approved decision (7J.1 decision #5)
  that a rejection reason must be non-empty even though the column
  itself is nullable at the database level: a bare "disputed" with no
  explanation gives the owner nothing to act on. Confirmed exactly as
  recommended — see the "V1 Signed-Off Contract" section above, item 5.
- **Dispute availability after circle lifecycle changes**: a dispute
  action should remain available even if the circle has since become
  `COMPLETED`/`ARCHIVED` — mirroring `rejectContribution`'s own rule that
  a legitimate action on an already-RECORDED row must not be blocked by
  an unrelated later lifecycle change to the circle. (This matters more
  in practice for *replay* of an already-DISPUTED action than for a
  *fresh* dispute, since §12/§13 propose that lifecycle can't advance
  past a round with an unresolved dispute anyway — but the rule should
  still be stated explicitly rather than left implicit.)
- **Dispute is a terminal historical fact** (§6, Option A). It should be
  understood and worded, in any future UI, as **"the recipient says the
  payout was not validly received"** — a claim recorded for the owner
  and any future administrator to act on, never an adjudication NIA
  itself performs. NIA does not investigate, does not move money to
  resolve the dispute, and does not decide who is right — it only
  records that a disagreement was raised, by whom, and why. This mirrors
  exactly the framing already established for contribution rejection
  ("this recorded attempt was not accepted as a valid contribution") and
  must avoid any wording that implies NIA holds, verifies, or arbitrates
  the underlying money movement.

## 10. Idempotency / replay

| Case | Proposed rule | Schema fit |
|---|---|---|
| Owner recording: same `clientOperationId`, same round/amount intent | Safe replay, returns the existing payout's current status | Fits unchanged — same `(circleId, clientOperationId)` unique-key replay pattern as `ContributionPayment` |
| Owner recording: same `clientOperationId`, different round/amount | Conflict, never a silent reuse | Fits unchanged — same reconcile-by-comparing-persisted-fields pattern as `recordContribution`'s `reconcileReplay` |
| Owner recording: different `clientOperationId`, same round, no existing payout yet | Second insert attempt races against the first; **the full `@@unique([roundId])` index is a stronger backstop than `ContributionPayment` needs**, since there is no "is there already an unresolved-or-confirmed one" ambiguity to preflight-check — any existing row at all (regardless of its status) blocks a new one | Fits unchanged, arguably simpler than the contribution case |
| Member confirmation: repeated legitimate `CONFIRMED` | Safe, zero-write replay; no new `confirmedAt` | Fits unchanged — identical shape to `confirmContribution`'s `resolveConfirmedReplay` |
| Member dispute: exact same `disputeReason` | Safe, zero-write, exact-intent replay; no new `disputedAt` | Fits unchanged — identical shape to `rejectContribution`'s `resolveRejectedReplay` |
| Member dispute: different `disputeReason` on replay | Intent conflict, never a silent overwrite | Fits unchanged — identical shape to `rejectContribution`'s intent-conflict rule |

**All of these semantics fit the current schema without modification**,
because the replay logic itself is a straight port of the already-proven
`ContributionPayment` pattern; the only structural difference (§6) is
that `Payout` has no partial-index "slot release" after a terminal
non-success outcome, which affects only whether a *second, distinct*
recording attempt is ever possible for the same round — not whether
*replaying the same operation* works correctly.

**Clarification added at 7K.3 implementation** (factual, does not reopen
any 7K.1 decision): an owner-recording replay does **not** simply return
the matched row once its round/amount intent matches. `recordPayout`
re-reads the round's authoritative `ContributionObligation` history on
the replay path too, and requires the persisted `Payout.amount`/
`currency` to still agree with that freshly recomputed
`computeExpectedPayoutAmount` result, alongside a matching `circleId`,
present recording provenance, and a `PayoutStatus` this contract knows.
A replay failing those checks is a distinct *persisted replay integrity
conflict* — never a repair, and never a silently-returned corrupted row.
This is stricter than the "safe replay" cell in the table above implies;
the table described intent matching only, which is necessary but not
sufficient. Cost is one extra indexed obligation read per replay, which
the correctness of never handing back a payout that no longer matches
its round's frozen pot clearly justifies.

## 11. Concurrency

**Serialization primitive: reuse the shared `SavingsCircle` row lock,
unchanged** — every payout-mutating transaction should begin with
`lockSavingsCircleForUpdate`, exactly like every contribution writer,
before touching any `Payout`/`PayoutRound` row. No new lock primitive is
needed.

**Where CAS (compare-and-swap) is required**: the confirm/dispute
transition, exactly like `confirmContribution`/`rejectContribution`'s
own `UPDATE ... WHERE status = 'RECORDED'` pattern — an affected-row-
count of zero means "no longer pending," resolved by re-reading fresh
state, never assumed to be an error.

**Where CAS is *not* the relevant guard**: owner recording's "only one
payout per round" invariant is enforced by the **full** unique index
(§6), not a partial one — so the "friendly preflight, atomic index as
backstop" two-layer pattern still applies, but the preflight check is
simpler (`findUnique({ where: { roundId } })` returning non-null is
sufficient; there is no "which status" branch to consider the way
`findActiveOrConfirmedPaymentForObligation` needs for contributions).

| Race | Expected resolution |
|---|---|
| Duplicate owner recording (same operation) | Idempotent replay resolves both to the same row, exactly like `recordContribution`'s own proven concurrent-duplicate-operation test |
| Two different recording operations for the same round | Exactly one wins (inserts), the other loses against the full unique index and must reconcile to a friendly conflict — same shape as `recordContribution`'s "concurrent competing operations" race, simplified by the stronger index |
| Confirm vs. dispute (same payout) | Whichever CAS update commits first wins; the loser observes zero affected rows and must treat that as "already resolved," never overwrite — identical to the existing real `confirm-vs-reject` race test for contributions |
| Concurrent confirms | Both resolve safely; the second is a zero-write replay — identical to the existing real concurrent-confirmation test |
| Concurrent disputes | Both resolve safely if the reason matches (replay) or conflict if it doesn't — identical to the existing real concurrent-rejection test |
| Owner recording vs. a lifecycle transition (e.g. some future round-closure writer) | Serialized automatically by the shared circle-row lock, exactly as `recordContribution` is already serialized against `activateCircle` today — **conditional on any future round/circle-lifecycle writer also taking the same lock first**, which is the one structural discipline every prior audit in this codebase has insisted on without exception |
| Member response vs. a lifecycle transition | Same answer — a dispute/confirm should be resolved (or safely replayed) before the lock, and re-checked once more inside it, exactly like `confirmContribution`'s own two-phase check |

**No writer bypasses the shared lock today, because no payout writer
exists yet** — this section is a design commitment for the writers this
ticket sequence has not yet built, not a finding about existing code.

## 12. Round lifecycle interaction — resolved 7K.1 (see sign-off, items 8/9)

**`PayoutRoundStatus` today:** `UPCOMING` (default, every round's
permanent status under current runtime), `ACTIVE`, `CLOSED` — a full
enum with zero writers for the latter two values anywhere in this
codebase.

**A revealing, previously-unstated architectural fact**: `PayoutRound`
already carries `activatedAt`/`activatedById` columns (populated `null`
at creation, schema-ready for a future "round activation" writer to
fill in), but has **no `closedById` column** — only `closedAt`. This
asymmetry is a real signal, not an oversight to fix here: it suggests
round *activation* was always intended as a discrete, actor-attributed
event (something/someone explicitly marks a round ACTIVE), while round
*closure* was intended as a **derived, computed consequence** of other
facts becoming true (no distinct actor decision to attribute) — directly
consistent with the ticket's own proposed rule.

**Proposed V1 rule, audited against the architecture and found
consistent, not merely assumed:**

```
Round becomes CLOSED only when:
  - every one of its ContributionObligations is FULFILLED, AND
  - its Payout is CONFIRMED
```

This fits the schema (`closedAt` with no actor column, exactly what a
system-derived transition needs) and fits the existing member-dashboard
convention of never trusting a persisted status as more authoritative
than the ledger it's supposed to summarize (`isObligationFulfilled` is
already ledger-derived, never `ContributionObligation.status`-derived,
for the identical reason).

**RESOLVED (7K.1): no.** This section originally surfaced a genuinely
open question — *does anything actually need `PayoutRound.status` to
reach `ACTIVE` at all?* — as Unresolved Architecture Question #2 (§18).
Contribution recording is already fully round-status-agnostic (7J.1
decision #1 — any persisted round accepts a contribution, `UPCOMING`
included), and §7's now-binding rule establishes the identical
permissiveness for payout recording. Since neither contribution nor
payout *recording* depends on a round being `ACTIVE`, the sign-off
confirms `ACTIVE` **is** purely a display/organizational concept
("which round should the UI call 'current'") for owner/member
orientation, not a gating mechanism for any write path — see the "V1
Signed-Off Contract" section above, item 9. `PayoutRoundStatus` is kept,
unremoved and uncollapsed; a future "round activation" ticket is
therefore *not* a prerequisite for payout recording and may be built
independently, later, purely for presentation.

**Payout and round-lifecycle tickets are confirmed separated**, per the
sign-off's item 8: `PayoutRound.status` transitions
(`UPCOMING → ACTIVE`, and the derived `→ CLOSED`) are explicitly out of
scope for every 7K payout-writer ticket, tracked as their own follow-on
lifecycle slice once payout mutations exist.

## 13. Circle completion interaction — intended rule frozen 7K.1 (see sign-off, item 10)

**No prior document in this codebase already states a frozen SUSU
circle-completion rule** — a targeted search of every `docs/product/*.md`
file and every SUSU service/domain file found no existing "circle
COMPLETED only when..." specification for SUSU circles (the analogous
concept exists for the unrelated Personal Savings `PersonalGoal`
completion feature, `goal-completion.service.ts`, which is a different
domain and not reused here). This audit originally treated the ticket's
own proposed rule as the **candidate** to evaluate, not as pre-existing
frozen intent to merely re-confirm; 7K.1 has since frozen the *intended*
rule as documentation (not yet implemented — see the sign-off section
above, item 10, including its explicit re-audit caveat).

**Proposed rule, evaluated:**

```
Circle COMPLETED only when:
  - every round CLOSED, AND
  - every obligation FULFILLED, AND
  - every payout CONFIRMED, AND
  - no unresolved payout dispute
```

**Which facts are redundant projections vs. authoritative**, audited
against §12's own rule: if "round CLOSED" is itself already defined as
"obligations FULFILLED AND payout CONFIRMED" (§12), then "every round
CLOSED" **already implies** "every obligation FULFILLED" and "every
payout CONFIRMED" — those two conjuncts would be **redundant
projections** of round-closure, not independently authoritative facts,
if §12's rule is adopted as written. The one conjunct that is *not*
redundant is "no unresolved payout dispute" — but under §6's Option A
(a `DISPUTED` payout is permanently terminal for its round), a disputed
round can **never** reach CLOSED in the first place (its payout can
never become CONFIRMED), so "no unresolved dispute" is *also* already
implied by "every round CLOSED," making the completion rule reducible to
a single authoritative fact: **every round CLOSED**. This is worth
recording plainly rather than carrying three redundant checks forward
into a future implementation, but the redundancy only holds if §12's
rule is adopted exactly as proposed — flagged as a consequence to
re-verify at implementation time, not asserted as independently certain
here.

**Not implemented here**, per this ticket's explicit instruction.

## 14. Member read model

**What the recipient already sees today** (§1): amount, status,
recordedAt, confirmedAt, disputedAt for their **own** round's payout
only — `disputeReason` and every actor id are currently absent from the
member dashboard's read, and non-recipient members never see any
`Payout` row at all (the query itself is conditioned on
`recipientRound`, which is `null` for anyone who isn't a recipient of
any round).

**What a future read model needs to add**, once confirm/dispute actions
exist: `disputeReason` (so the recipient can review their own past
dispute text on replay/re-display — currently omitted, presumably
because there was nothing to act on with it before this ticket), and
whatever minimal round/recipient identity fields a confirm/dispute
control needs to render (`roundId` is already implied by
`recipientRound`, needs no new field). No actor id
(`recordedById`/`confirmedByMemberId`/`disputedByMemberId`) should be
added to this read model — the owner's own identity is never useful to
a member, and a recipient's own confirm/dispute identity is always
"themselves," never worth round-tripping back.

**Privacy boundary to preserve, not merely inherit**: the existing
read-side boundary ("only the recipient's own round's payout is ever
queried") must be carried forward unchanged into any future
confirm/dispute **action** as well — a future `confirmPayoutAction`/
`disputePayoutAction` must independently verify `identity.memberId ===
round.recipientId` (§8/§9) rather than relying on the read model having
already filtered correctly, exactly as this codebase's own established
discipline requires action-level re-verification never to depend on
UI-level filtering.

**7K.8 implementation note** (factual, does not reopen any 7K.1 decision):
the `disputeReason` addition anticipated above was built as a **new,
separate** read (`getCircleMemberPayouts`,
`payout-member-read.repository.ts`/`.service.ts`), not as an extension of
`getCircleMemberDashboard` (7H.2). Two reasons, both structural rather
than stylistic: (1) the dashboard's own recipient-round resolution
(`rounds.find((round) => round.recipientId === memberId)`) is
application-code filtering over every round the circle has, because
`roundSchedule`/`currentRound`/`nextRound` genuinely need the full
schedule — this new read instead filters `WHERE circleId AND recipientId
= memberId` at the database layer, which retrofitting onto the
dashboard's existing all-rounds query would either break or require a
second, differently-filtered round query inside the same service; (2)
`getCircleMemberDashboard`'s own existing `payout` field
(`amount`/`status`/`recordedAt`/`confirmedAt`/`disputedAt`) is
**unchanged** — no `disputeReason` or `expectedPayout` was added to it.
Both reads now coexist: the dashboard keeps its own minimal summary
(unmodified, all of 7H.2's own tests untouched), and
`getCircleMemberPayouts` is the one place that answers "what is my own
payout, in full detail" — including `disputeReason` and the per-round
`expectedPayout` this section always anticipated. A future dashboard
revision may choose to call the new service instead of duplicating it
further, but that is not decided or required here.

## 15. Owner read model

Per-round, the owner needs (design only, no UI or service proposed
here):

- Recipient (already available via `circle-active-owner.service.ts`'s
  existing round data).
- Expected payout amount — the obligation-sum from §5 (a **new** query,
  not currently exposed by any existing owner read model).
- Payout status (`RECORDED`/`CONFIRMED`/`DISPUTED`, or "not yet
  recorded" when no row exists) — a **new** read, symmetric to how
  `contribution-owner-read.service.ts` already exposes payment status
  for contributions.
- Recorded time; confirmation or dispute result and time.
- Dispute reason (owner needs to see it — they are the one who must act
  on it, per §9).
- **Round contribution readiness**: whether every obligation for that
  round is currently `FULFILLED` (ledger-derived, via the same
  `isObligationFulfilled` helper contributions already use) — useful
  context for the owner deciding when to record a payout, even under
  the permissive §7 rule that doesn't *require* it.

This is new read-model surface, symmetric in shape and privacy posture
to `getOwnerCircleContributions` (7J.5) — likely its own narrow ticket
(§18), reusing the identical "separate, owner-scoped repository, never
widening the member-facing one" discipline already established.

**7K.7 implementation note** (factual, does not reopen any 7K.1
decision): `getOwnerCirclePayouts` deliberately diverges from
`getActiveCircleSummaryForOwner` (7I.6) and `getOwnerCircleContributions`
(7J.5), both of which are ACTIVE-only by their own explicit design (7I.6's
own comment: "until a future ticket extends this read... COMPLETED/
ARCHIVED circles... must never be misrepresented as ACTIVE"). This read
is available for `ACTIVE`, `COMPLETED`, and `ARCHIVED` circles — rejecting
only `DRAFT`/`CANCELLED`, where no `PayoutRound`/`ContributionObligation`
rows exist at all (both are created only at activation). Reasoning: a
circle's payout history is a permanent accounting fact once recorded — it
does not stop being true, or become unreadable to the owner who recorded
it, merely because the circle later completes or is archived. This
mirrors the identical rule already frozen for the recipient side
(`confirmPayout`/`disputePayout`'s own replay-must-survive-COMPLETED/
ARCHIVED contract, §7K.4/§7K.5) and is a narrower, read-only extension of
it — 7I.6/7J.5's own ACTIVE-only boundary is untouched for the read
models those tickets built; only this new payout read adopts the wider
lifecycle.

## 16. Security / privacy

- **Owner payout writes**: `requireUser()` at the Server Action
  boundary, `ownerId` derived exclusively from it, service-level
  ownership re-check under the circle-row lock — identical, unmodified
  pattern to every existing owner mutation (draft membership, payout
  order, activation, contribution recording).
- **Recipient payout decisions**: `requireCircleMember(circleId)`,
  fresh membership/circle validation (already built into that
  primitive), plus the one additional persisted-recipient check this
  workflow specifically needs (§8/§9) that no existing primitive
  performs on its own.
- **No platform User impersonation**: a recipient's identity always
  comes from `CircleMemberSession`, never from any platform `User`
  session, mirroring the existing hard separation between the two
  identity systems everywhere else in this codebase.
- **No owner override pretending to be recipient**: structurally
  enforced by keeping `confirmedByMemberId`/`disputedByMemberId`
  writable only from the member-session-authenticated code path, never
  from the owner's own action.
- **No member PIN/session/token data in any financial read model**:
  already true today (§1's field-level review of `memberPayoutSelect`
  confirms no such field is ever selected), and must remain true for
  every new read model this workflow adds — `pinHash`,
  `failedPinAttempts`, `credentialVersion`, `CircleMemberSession` rows,
  and rate-limit data must never appear in a payout read model, exactly
  as the existing contribution read models already avoid them.

## 17. V1 non-goals (explicitly frozen out, unless a compelling reason emerges)

Payment gateway, mobile money integration, bank transfer integration,
escrow, NIA-held funds, payout reversal, partial payout, split payout,
replacement recipient, redistribution after dispute, owner adjudication,
refund workflow, late fees, penalties, loans, interest, automatic
collection, automatic payout execution. None of these has any supporting
infrastructure anywhere in this schema or codebase today, matching this
ticket's own list exactly — nothing here contradicts or requires
revisiting any of them.

## 18. Architecture questions — all resolved by 7K.1

Originally titled "Unresolved architecture questions." Every item below
was resolved by explicit product/architecture sign-off in 7K.1 — see the
"V1 Signed-Off Contract" section at the top of this document for the
binding statements. The original reasoning is retained unchanged below;
only the resolution status has been annotated.

1. **RESOLVED (7K.1) — Option A.** ~~(P1) `DISPUTED` terminality~~ (§6):
   accept Option A (permanent, administrative-resolution-only, no schema
   change, recommended) or Option B (partial unique index migration
   enabling a fresh attempt after dispute)? This must be an explicit
   product decision before the confirm/dispute writer is built — it
   changes that writer's own replay and conflict-handling shape.
2. **RESOLVED (7K.1) — no; `ACTIVE` is display/orientation-only.**
   ~~(P1) Does anything gate on `PayoutRound.status` reaching `ACTIVE`
   at all~~ (§12), or is the whole `UPCOMING`/`ACTIVE`/`CLOSED` lifecycle
   (apart from the derived `CLOSED` transition) a display-only concept
   for V1? This determines whether a "round activation" ticket is a
   prerequisite for payout recording or can be built independently,
   later, purely for UI "current round" framing.
3. **RESOLVED (7K.1) — confirmed as recommended.** ~~(P2) Owner
   recording eligibility~~ (§7): confirm the recommended permissive
   default (any persisted round, circle ACTIVE, no
   round-status/fulfillment gating) — narrow in scope, safe to confirm
   alongside the first recording-service ticket rather than blocking
   this audit's closure.
4. **RESOLVED (7K.1) — required, confirmed as recommended.** ~~(P2)
   `disputeReason` required vs. optional~~ (§9): recommended required,
   mirroring the contribution-rejection precedent — narrow, safe to
   confirm alongside the confirm/dispute-service ticket.
5. **Still deferred, P3 — not part of 7K.1's sign-off scope.** (P3)
   Denormalizing the round's expected payout amount onto `PayoutRound`
   itself, instead of summing obligations on every read (§5): a pure
   performance/convenience question, not a correctness one — defer
   indefinitely unless a real read-latency problem is observed.

## 19. Findings, classified

- **P0 (current persistence cannot safely represent V1 payout truth):**
  none found. Every fact this workflow needs — amount, recipient,
  actor/timestamp provenance for record/confirm/dispute — is already
  representable, exactly, by the existing schema.
- **P1 (must resolve before first payout writer):** originally Questions
  #1 and #2 (§18) — **both resolved by 7K.1 sign-off** (Option A for
  dispute terminality; `ACTIVE` confirmed display-only). **No P1 items
  remain open.**
- **P2 (safe to defer within Phase 7):** originally Questions #3 and #4
  (§18) — **both confirmed by 7K.1 sign-off** exactly as recommended.
  **No P2 items remain open.**
- **P3 (polish/future enhancement):** Question #5 (§18) — denormalizing
  the payout amount, still deferred (not part of 7K.1's sign-off scope);
  also, adding `disputeReason` to the member read model (§14) remains a
  small, uncontroversial follow-on once a dispute action exists.

**No P0/P1 schema issue was ever found requiring a blocking report at
the audit stage** — the two P1 items were decisions to make, not defects
to fix, and 7K.1 has since made both of them, adopting this document's
own recommendations (Option A for §18.1, "yes it's display-only" for
§18.2) exactly as proposed. As of 7K.1, **zero P0/P1 items remain open**
— the next ticket may proceed directly to implementation against the
signed-off contract.

## 20. Proposed 7K+ implementation sequence

Mirroring the contribution workflow's own narrow-ticket precedent
(7J.1–7J.8):

- **7K (this ticket)** — ✅ **COMPLETE.** Payout domain audit. No
  service, repository, action, UI, or schema change.
- **7K.1** — ✅ **COMPLETE.** Product/architecture sign-off on Questions
  #1 and #2 (§18), plus confirmation of #3/#4 — see the "V1 Signed-Off
  Contract" section at the top of this document. Documentation-only; no
  schema, service, repository, action, UI, or test changed.
- **7K.2** — ✅ **COMPLETE.** Payout domain contract:
  `src/domain/payout-accounting.ts` (`computeExpectedPayoutAmount`,
  deriving §5's obligation-sum and rejecting an empty or
  currency-inconsistent obligation set as a new
  `PayoutAccountingIntegrityError`; `amountMatchesExpectedPayout`, a
  reuse-not-duplicate alias of `contribution-accounting.ts`'s own
  `amountMatchesObligation`), `src/domain/payout-state.ts` (the
  `RECORDED → CONFIRMED`/`RECORDED → DISPUTED` transition contract and
  `PAYOUT_REPLAY_CONTRACT_KEYS`, mirroring `contribution-state.ts`
  exactly), and `src/validations/payout.schema.ts`
  (`recordPayoutSchema`/`confirmPayoutSchema`/`disputePayoutSchema`).
  **Correction to this document's own earlier speculation**: the
  recording schema *does* accept a client-supplied `amount` (mirroring
  `recordContributionSchema` exactly) — the owner asserts what they paid
  out, and the future `recordPayout` service validates it against
  `computeExpectedPayoutAmount` via `amountMatchesExpectedPayout`, the
  same "client supplies, server verifies exactly" shape contributions
  already use; the amount is never trusted from the client without that
  check, but it is real client input, not silently derived instead of
  requested. No service, repository, action, UI, or schema change.
- **7K.3** — ✅ **COMPLETE.** Payout recording service:
  `src/repositories/payout-recording.repository.ts` and
  `src/services/payout-recording.service.ts` (`recordPayout`), circle-row-
  locked per §11, eligibility per §7/7K.1 item 3, amount/currency authority
  per §5/7K.1 item 1, idempotency and one-payout-per-round per §10/7K.1
  item 6, plus the replay-integrity clarification recorded in §10 above.
  Recipient confirmation/dispute, Server Actions, UI, round lifecycle, and
  circle completion all remain out of scope. **No schema migration** — the
  existing persistence contract carried the service unchanged, as §5/§6
  predicted.
- **7K.4** — ✅ **COMPLETE.** Payout confirmation service (`confirmPayout`),
  per §6 (Option A, binding per 7K.1)/§8/§10/§11.
- **7K.5** — ✅ **COMPLETE.** Payout dispute service (`disputePayout`), per
  §6/§9/§10/§11, including the real confirm-vs-dispute concurrency race
  (§11's table).
- **7K.6** — ✅ **COMPLETE.** Owner and recipient payout Server Actions,
  delivered together as one ticket rather than the two originally
  anticipated here: `recordPayoutAction` (`requireUser()`) and
  `confirmPayoutAction`/`disputePayoutAction` (`requireCircleMember`, per
  §8/§9/§16), each a thin wrapper around its already-complete 7K.3/7K.4/
  7K.5 service.
- **7K.7** — ✅ **COMPLETE.** Owner-facing payout read model
  (`getOwnerCirclePayouts`, §15) — a new, separate read-only
  repository/service, not an extension of `circle-active-owner.service.ts`
  (kept unwidened, per §12's own privacy discipline). See §15's own 7K.7
  implementation note for the ACTIVE/COMPLETED/ARCHIVED lifecycle
  boundary decision.
- **7K.8** — ✅ **COMPLETE.** Member-facing payout read model
  (`getCircleMemberPayouts`, §14) — delivered as a new, separate
  read-only repository/service (`payout-member-read.repository.ts`/
  `.service.ts`) rather than an extension of `getCircleMemberDashboard`
  (7H.2, left unmodified). Adds `disputeReason` and per-round
  `expectedPayout`, filtered at the database layer by
  `circleId AND recipientId = memberId`. See §14's own 7K.8
  implementation note.
- **7K.9** — ✅ **COMPLETE.** Owner payout-recording UI: `payout-desk.tsx`
  wired into the ACTIVE owner workspace alongside `ContributionDesk`,
  rendering `getOwnerCirclePayouts` (7K.7) and a `RecordPayoutForm` bound
  to `recordPayoutAction` (7K.6). No owner confirm/dispute control; no
  round-lifecycle mutation.
- **7K.10** — ✅ **COMPLETE.** Recipient confirm/dispute UI: `member-payout
  -card.tsx` additively wired into the member dashboard (`getCircleMember
  Dashboard` itself untouched), rendering `getCircleMemberPayouts` (7K.8)
  and `member-payout-controls.tsx` (confirm + dispute) bound to `confirm
  PayoutAction`/`disputePayoutAction` (7K.6). Decision controls appear
  only for a RECORDED payout, never gated on `round.status`.
- **7K.11** — ✅ **COMPLETE, this document's own new §21.** Round
  lifecycle audit & V1 contract for `UPCOMING → ACTIVE → CLOSED`.
  **Renumbered from this list's original plan**: the sequence originally
  drafted here called 7K.11 "live concurrency verification" (mirroring
  7J.9) — that work was never separately ticketed and is superseded by
  this entry; live concurrency coverage for payout confirm/dispute
  already shipped as part of 7K.4/7K.5 themselves (see those sections'
  own real-race tests), so no separate concurrency-only ticket was ever
  needed. Documentation/architecture only — no service, repository,
  action, UI, or schema change. See §21 for the full contract.
- **7K.12** — ✅ **COMPLETE.** Round closure provenance persistence:
  `PayoutRound.closedById` (schema + migration only, §21.15's own
  implementation note) — closing the one schema gap §21.11 identified.
  No round-lifecycle runtime behavior; `assertActivatedRotationIntegrity`
  deliberately unchanged.
- **7K.13** — ✅ **COMPLETE.** Round lifecycle services:
  `activateFirstRound`/`advanceRound` (§21.22's own recommended API,
  §21.28's own implementation note) — `src/domain/round-lifecycle.ts`,
  `src/repositories/round-lifecycle.repository.ts`,
  `src/services/round-lifecycle.service.ts`, plus the required
  `assertActivatedRotationIntegrity` evolution in `circle.service.ts`
  (§21.3). No Server Actions, no UI, no circle completion, no schema
  change.
- **Circle completion** — confirmed by 7K.1 as its own future slice,
  deliberately not a prerequisite for any 7K payout-writer ticket. §21.25
  freezes "every round CLOSED" as sufficient domain authority for it; not
  implemented by 7K.13 or any ticket before it.

## 21. Round Lifecycle V1 Contract — 7K.11 (Audit & Freeze)

**Status: audit and contract only. No runtime lifecycle behavior exists
yet.** Every claim below is sourced from direct reads of
`prisma/schema.prisma`, `src/repositories/circle.repository.ts`,
`src/services/circle.service.ts` (`activateCircle` and
`assertActivatedRotationIntegrity`), `src/domain/circle-rotation-
schedule.ts`, `src/domain/circle-round-selection.ts`, every payout/
contribution service under `src/services/`, and a codebase-wide grep for
every runtime write to `PayoutRound` — not assumed from this document's
own earlier sections or from ticket text.

### 21.1 The historical question

**"What historical information must round progression preserve so the
state of a SUSU circle can still be understood correctly years later?"**

- **Which round was ACTIVE, when, and why.** `PayoutRound.activatedAt`/
  `activatedById` — once a lifecycle writer exists, these must record the
  real actor and instant a round's collection period began, never
  reconstructed from "whichever round currently has the lowest
  roundNumber."
- **Which round was CLOSED, and when.** `PayoutRound.closedAt` — see
  §21.15 for whether `closedById` must also exist.
- **That closure depended on specific, already-frozen financial facts**
  (§21.9) — not re-derivable after the fact from `PayoutRound` alone; the
  historical authority for "were obligations fulfilled" and "was the
  payout confirmed" remains `ContributionObligation`/`ContributionPayment`
  /`Payout`, exactly as already frozen (§§4–10 of this document). Round
  lifecycle never duplicates that data onto `PayoutRound` itself.
- **Which member was the authoritative recipient of each round** —
  already frozen: `PayoutRound.recipientId`, immutable since activation
  (§1). Lifecycle progression reads this, never re-derives it from
  current `payoutOrder`.
- **How next-round progression is reconstructed historically** — the
  answer this section freezes: purely from `PayoutRound.roundNumber`
  (persisted, frozen at activation) plus each round's own `status`/
  `activatedAt`/`closedAt` — never from `CircleMember.payoutOrder`, never
  from today's date, never from `SavingsCircle.frequency`.

**Rule, restated:** everything on `PayoutRound` once created (identity,
`recipientId`, `dueDate`, `roundNumber`) remains immutable; only `status`
and its two corresponding provenance groups (`activatedAt`/`activatedById`,
`closedAt`[/`closedById`, see §21.15]) are ever written after creation,
each exactly once, on the one permitted transition into that state. This
mirrors `Payout`'s own immutability rule (§4) exactly.

### 21.2 Current persistence — confirmed field-by-field

`SavingsCircle` (`prisma/schema.prisma:207-238`): `status`
(`CircleStatus`: DRAFT/ACTIVE/COMPLETED/CANCELLED/ARCHIVED), `startDate`,
`activatedAt`/`activatedById`, `completedAt`/`completedById`,
`archivedAt`/`archivedById` — all three lifecycle transitions already
have full actor+timestamp provenance columns, even though only
`activatedAt`/`activatedById` currently have a writer (`activateCircle`).
`completedAt`/`completedById`/`archivedAt`/`archivedById` exist in schema
today with **zero runtime writer anywhere** (confirmed by the same
codebase-wide grep methodology as §1's own "zero runtime writer" finding
for `Payout`) — circle completion and archival are schema-ready but
unimplemented, exactly like payout recording once was.

`PayoutRound` (`prisma/schema.prisma:319-346`): `status`
(`PayoutRoundStatus`: UPCOMING/ACTIVE/CLOSED, `@default(UPCOMING)`),
`roundNumber`, `recipientId` (compound FK to `CircleMember(id, circleId)`),
`dueDate`, `activatedAt`, `activatedById` (FK to `User`), `closedAt`.
**Confirmed: no `closedById` field exists in the schema today** — `closedAt`
has no actor-provenance counterpart, unlike every other terminal-ish
transition in this system (`recordedById`, `confirmedByMemberId`,
`disputedByMemberId`, `activatedById`, `completedById`, `archivedById`).
See §21.15 for the decision this asymmetry now requires.
`@@unique([circleId, roundNumber])`, `@@unique([circleId, recipientId])`,
`@@unique([id, circleId])`, `@@index([circleId, status, roundNumber])` —
no unique constraint of any kind exists on `status` itself (see §21.8).

`ContributionObligation`/`ContributionPayment`/`Payout`/`CircleMember`:
unchanged from §§2 and prior contribution-workflow audits; not restated
here except where a specific lifecycle predicate depends on an exact
field (§21.9).

### 21.3 Current round writers — confirmed: exactly one, at creation only

A codebase-wide grep for every call to `.payoutRound.update`,
`.updateMany`, `.upsert`, or `.delete` returns **zero results**. The
**only** write to `PayoutRound` anywhere in runtime code is
`createCircleActivationRounds` (`circle.repository.ts:262-282`), called
from `activateCircle` (`circle.service.ts:597-604`), which creates one
row per ACTIVE member with:

```
status: "UPCOMING", activatedAt: null, activatedById: null, closedAt: null
```

**Confirmed: no runtime code activates or closes a round today.** No
contribution writer (`recordContribution`/`confirmContribution`/
`rejectContribution`), no payout writer (`recordPayout`/`confirmPayout`/
`disputePayout`), and no read model reads-then-writes `PayoutRound.status`
as a side effect — every one of those six services was independently
audited (payout services in this document's own §§7–11; contribution
services carry the identical, already-frozen guarantee from the 7J
audit/freeze) and none references `payoutRound.update*` anywhere in its
own source. This document's own earlier §1 finding ("no round is ever
created ACTIVE... nothing writes `PayoutRound.status`") is reconfirmed,
not merely repeated from memory.

**A load-bearing finding for the next implementation ticket, discovered
by this audit:** `assertActivatedRotationIntegrity`
(`circle.service.ts:289-356`) — the defensive re-verification function
`activateCircle` runs both on a fresh activation and on every **replay**
of an already-ACTIVE circle's activation call — currently hard-asserts,
for **every** persisted round, that `round.status !== "UPCOMING"` is a
disqualifying integrity failure (alongside `activatedAt !== null`,
`activatedById !== null`, and `closedAt !== null`, each also disqualifying).
In plain terms: **this function today assumes every round remains
UPCOMING forever**, and will throw `CircleActivationIntegrityError` for a
circle whose rounds have legitimately progressed once a lifecycle writer
exists.

This is **not** a current bug (no lifecycle writer exists yet, so this
branch is unreachable today) and does **not** block freezing this
contract. But it **is** a concrete, required code change for whichever
ticket implements round lifecycle: `activateCircle`'s own replay branch
(`circle.service.ts:572-583`, reached only when a caller resubmits an
activation request for a circle that is already ACTIVE — e.g. a retried
form submission) must stop treating "a round is no longer UPCOMING" as
corruption. The narrowest correct fix is to relax
`assertActivatedRotationIntegrity`'s four disqualifying checks to their
activation-time invariants only (`roundNumber`/`recipientId`/`dueDate`
match, obligations intact) and drop the `status`/`activatedAt`/
`activatedById`/`closedAt` checks entirely from this function — round
lifecycle's own future integrity checks (§21.20) become the authority for
those fields instead, exactly as this document's own established
discipline already separates "activation-time shape integrity" from
"payout/dispute provenance integrity" into different functions rather
than one function trying to own both. **Flagged as a required, scoped
implementation-ticket task — not implemented here, per this ticket's own
explicit "documentation only" instruction.**

### 21.4 Current display/read assumptions — confirmed, already compatible

`selectCurrentAndNextRound` (`src/domain/circle-round-selection.ts`),
shared unchanged by `circle-active-owner.service.ts` (owner) and
`circle-member-dashboard.service.ts` (member):

- Exactly one `ACTIVE` round → that round is `currentRound`, `nextRound`
  is `null`.
- Zero `ACTIVE` rounds, circle status `ACTIVE` → the lowest-`roundNumber`
  round that is not `CLOSED` becomes `nextRound` (never `currentRound`);
  if every round is `CLOSED`, both are `null`.
- Zero `ACTIVE` rounds, circle status not `ACTIVE` → both `null`
  (reachable in practice only for COMPLETED/ARCHIVED, since `requireCircleMember`
  excludes DRAFT/CANCELLED from ever reaching a dashboard read).
- **Not explicitly handled: more than one `ACTIVE` round.** The
  `activeRounds.length === 1` check simply falls through when the count is
  ≠ 1 (0 or ≥2 alike), landing on the "lowest non-CLOSED round" branch
  either way — a genuine multi-ACTIVE corruption would silently render as
  "no current round, next round = the lowest non-closed one," **never**
  surfacing as an error to the owner or member. This is unreachable today
  (no writer can produce it) and is not a defect in the read layer's
  existing contract (it was never asked to detect write-side corruption),
  but it means **the read layer provides no safety net** — §21.8/§21.20
  therefore places the entire burden of preventing a multi-ACTIVE state on
  the future lifecycle writer's own CAS/lock discipline, not on defensive
  reads. A future ticket may choose to harden the read helper to detect
  and explicitly flag `activeRounds.length > 1` as an integrity error, but
  this is not required for 7K.11's own contract to be sound, and is not
  decided here.

`payout-desk.tsx` (owner) and `member-payout-card.tsx`/`member-dashboard
.tsx` (member) render **every** persisted round's own `status` verbatim
(via `getRoundStatusBadge`/`getRoundStatusPresentation`) and never
introduce a second "current round" concept of their own — `payout-desk
.tsx` in particular has no current/next distinction at all, listing every
round unconditionally. **No existing UI/read-model code assumes anything
beyond**: "zero or one round may be ACTIVE at a time" is treated as the
only two expected states, and a `CLOSED` count (`closedRoundCount` in the
owner summary) is displayed as a plain progress figure, never used to
gate any read or write.

**Reassuring finding, not merely neutral:** because `selectCurrentAndNextRound`
already gracefully renders "next round = round 1, still UPCOMING" (the
exact shape a circle is in immediately after activation, before any
lifecycle writer exists) and "no current or next round" (the exact shape
once every round is CLOSED, before circle completion exists), **the
already-shipped display layer requires zero changes** to correctly render
either of the two legitimate zero-ACTIVE states this contract freezes in
§21.8 — both were, whether by design or fortunate convergence, already
anticipated by the 7H.2/7I.6 read models built before any lifecycle
writer existed.

### 21.5 Round status purpose — frozen

**`PayoutRound.status` is an operational/progression marker. It is NOT,
and never becomes, financial mutation authorization.** This document's
own frozen contract already established the inverse direction of this
rule for payouts (7K.1 item 3: payout recording is never gated by round
status) and for contributions (7J.1 decision #1, restated at §1/§7 of
this document); this section extends the SAME rule to state it applies
in **both** directions and is not narrowed by round lifecycle's own
future existence:

- Contribution recording/confirmation/rejection remain governed **only**
  by the already-frozen 7J rules. A late contribution for round 1 may
  still be recorded and confirmed while round 3 is the current ACTIVE
  round, exactly as today.
- Payout recording/confirmation/dispute remain governed **only** by the
  already-frozen 7K rules (this document, §§7–11). `ACTIVE` is never
  reinterpreted as "the only round whose financial records may change."
- **Verified compatible, not merely asserted:** every one of the six
  existing financial writers (`recordContribution`, `confirmContribution`,
  `rejectContribution`, `recordPayout`, `confirmPayout`, `disputePayout`)
  was independently confirmed, by direct source read, to contain **no**
  reference to `PayoutRound.status` at all — round lifecycle can be
  implemented without touching, and without needing to touch, any of
  those six functions.

### 21.6 V1 state machine — frozen

```
UPCOMING → ACTIVE → CLOSED
```

Forbidden, absolutely, in V1: `CLOSED → ACTIVE`, `CLOSED → UPCOMING`,
`ACTIVE → UPCOMING`, `UPCOMING → CLOSED` directly (skipping ACTIVE). No
reopening. No round-level cancellation state (schema has none — adding
one is out of scope, §21.26). No skipped rounds (§21.11). No replacement
recipient, no reassignment after activation (already immutable, §1/§21.1).

**Schema support: fully sufficient, no migration required for the state
machine itself.** `PayoutRoundStatus` already has exactly the three
values this machine needs; nothing about the transition rules above
requires a new enum value, a new column, or a new table. (§21.15 covers
the one, narrower, provenance-column question — not the state machine.)

### 21.7 First-round activation — DECISION: Option B, frozen

**Frozen: circle activation leaves every round `UPCOMING`
(`activatedAt`/`activatedById` both `null`) — exactly `activateCircle`'s
own already-shipped, already-frozen (7I.5) behavior, confirmed unchanged
by direct read in §21.3. Round 1's activation is a distinct, explicit,
separately-ticketed owner action, not a side effect of `activateCircle`.**

Evaluated against every criterion this ticket names:

- **No amendment to a frozen contract required.** Option A would require
  changing `activateCircle` itself — an already-shipped, already-frozen
  (7I.5) implementation contract — to additionally decide "and round 1
  becomes ACTIVE" inside the same atomic write. Option B requires
  **zero** change to `activateCircle`; it is already exactly this. Per
  this ticket's own instruction ("state explicitly that it would amend an
  earlier frozen contract and why that is worth doing"): no such
  justification was found strong enough to outweigh leaving a
  already-correct, already-tested function untouched.
- **Auditability / user mental model.** Activating a circle ("the cohort
  and rotation are now locked in") and starting round 1's collection
  period ("the clock on round 1 has begun") are two conceptually distinct
  facts an owner may reasonably want to confirm as two deliberate
  moments, not one bundled click. This mirrors the already-frozen
  reasoning for why payout recording and payout confirmation are separate
  actor-attributed events rather than one bundled write.
- **circle.startDate semantics.** §21.17 concludes `startDate` is a
  schedule/display anchor for due-date computation, not an activation
  trigger — Option A would have had to either ignore `startDate` (an
  odd inconsistency) or silently treat it as an implicit "auto-start"
  condition, reopening exactly the ambiguity Option C is rejected for.
  Option B requires no interpretation of `startDate` as anything other
  than what it already is.
- **No background scheduler exists, and Option C is rejected outright.**
  A codebase-wide grep for `cron`/`scheduler`/`setInterval` confirms this
  application has **no** background job infrastructure of any kind. Option
  C (auto-activate round 1 based on `startDate`/current date) would
  require inventing net-new infrastructure this codebase has never had,
  purely to save one owner click — and would make "why did round 1
  become ACTIVE" unanswerable from any single request/actor, violating
  §21.1's own historical-authority requirement (`activatedById` would
  have no honest value to record). **Rejected, without qualification.**
- **Race safety.** A tie between Option A and B — round 1's identity is
  deterministic (`roundNumber = 1`) either way, and whichever operation
  performs the write still does so under the shared `SavingsCircle` lock
  (§21.18). Not a deciding factor.
- **Future mobile/API behavior.** Option B is strictly more flexible: a
  future non-web client gains one more explicit, individually-callable
  operation (`activateFirstRound`) rather than an implicit side effect
  buried inside circle activation's own response shape.

**Legitimate consequence, made explicit:** a circle may remain `ACTIVE`
with **zero `ACTIVE` rounds** indefinitely, for as long as the owner has
not yet explicitly started round 1. This is not a corrupted or
transient state — it is the expected, normal shape of a freshly-activated
circle in V1, and (per §21.4) the existing display layer already renders
it correctly today with zero changes required.

### 21.8 Exactly-one-ACTIVE invariant — frozen

**At most one `ACTIVE` round, always. Exactly one `ACTIVE` round while
progression is "in flight" (round 1 has been explicitly started and not
every round is yet `CLOSED`).** Legitimate zero-`ACTIVE` states,
enumerated exhaustively:

1. **Pre-round-1-start** (§21.7) — may persist indefinitely.
2. **Post-final-round-closure, pre-circle-completion** — every round
   `CLOSED`, circle still `ACTIVE`; a valid, expected pre-completion state
   (§21.13/§21.25).
3. **Corrupted state only** — anything else with zero `ACTIVE` rounds
   mid-rotation (some `CLOSED`, some `UPCOMING`, none `ACTIVE`, with the
   rotation not yet complete) is **not** legitimate and must be refused as
   a lifecycle integrity error by any future write attempt that discovers
   it (§21.20) — it means progression got stuck without an `ACTIVE`
   round, which no correctly-serialized writer can produce on its own.

**Schema constraint: not required for V1.** No unique index on `status`
exists today (§21.2), and none is recommended. Reasoning: exactly one
service will ever write `PayoutRound.status` (the future lifecycle
service), every write happens under the shared `SavingsCircle` row lock
(§21.18), and each transition is a single, CAS-guarded, single-writer
operation performed inside one transaction — there is no code path, now
or reachable in V1, through which two different rounds could be set
`ACTIVE` by two different uncoordinated writers, unlike `Payout`'s own
`@@unique([roundId])` (which defends against a *distinct future writer*
retrying a already-occupied slot — a scenario that genuinely can and does
happen for payout recording, §6). A DB-level partial unique index
(`WHERE status = 'ACTIVE'`, scoped per `circleId`) would be pure
defense-in-depth against a hypothetical future bug in a writer that does
not yet exist, not a correctness requirement — consistent with this
ticket's own "prefer no migration unless a genuine integrity hole
requires one." **Decision: no migration for this invariant.** The future
lifecycle service's own test suite must instead prove this invariant
holds under real concurrency (mirroring 7K.5's own real confirm-vs-dispute
race test) as its actual defense.

### 21.9 Round closure financial predicate — frozen, precisely

A round may close only when **all three** hold:

1. Every persisted `ContributionObligation` for that round is `FULFILLED`.
2. The round has a `Payout` row (guaranteed at most one, by
   `@@unique([roundId])`, §6).
3. That `Payout.status === "CONFIRMED"`.

Therefore: no payout → cannot close. `RECORDED` payout → cannot close.
`DISPUTED` payout → cannot close (§21.10). Any `OPEN` obligation → cannot
close. **Never required**: `dueDate` having arrived, the round being the
current calendar period, every `ContributionPayment` attempt being
non-`REJECTED`, or the absence of historical rejected attempts — a
rejected-then-successfully-recorded-and-confirmed contribution history is
exactly as eligible as a first-attempt success (already the frozen 7J
rule; round closure does not narrow it).

**Projection-integrity question, answered: closure must re-derive
obligation fulfillment from the confirmed-payment ledger, never trust
`ContributionObligation.status` alone.** `ContributionObligation.status`
**is** written (`fulfillOpenObligation`, atomically alongside payment
confirmation) — it is not a purely-derived display field — but this
document's own repeatedly-cited discipline (§1, and the 7H/7J audits
before it) holds that `.status` must never be trusted as *sole* payment
truth by any consumer. Round closure is a consumer. **Recommended
implementation boundary**: reuse `isObligationFulfilled`/
`amountMatchesObligation` (`src/domain/contribution-accounting.ts`,
already-proven, already-shared by `contribution-owner-read.service.ts`
and `circle-member-dashboard.service.ts`) against a fresh, lock-held
confirmed-payment-sum read (the same `findConfirmedPaymentSums`-shaped
query those services already use) — **not** a new validation concept,
the exact same one, called one more time. Symmetrically, the payout leg
of the predicate should reuse `computeExpectedPayoutAmount`/
`amountMatchesExpectedPayout` (`src/domain/payout-accounting.ts`) against
the round's frozen obligations, exactly as `payout-owner-read.service.ts`
/`payout-member-read.service.ts` already do (§21's own sibling read
models) — never a third, independently-reimplemented amount check.

### 21.10 Disputed payout effect — frozen

**A `DISPUTED` payout permanently blocks that round's closure in V1.**
Because V1 has no payout reversal, no replacement payout, no owner
override, and no dispute adjudication (already frozen, §6/this document's
own non-goals), a disputed round has no path back to a closeable state —
it may remain `ACTIVE` and unclosed indefinitely. **This is intentional,
not a lifecycle bug**, restated from this document's own earlier language
(§6) and now extended explicitly to round progression.

**Frozen consequence for later rounds: YES — a dispute in round N
permanently prevents round N+1 (and every round after it) from becoming
`ACTIVE`.** This is not an independent rule requiring its own enforcement
mechanism; it falls out directly, as a corollary, from §21.9 (round N
cannot close while disputed) combined with §21.11 (round N+1 cannot
activate until round N closes). A circle progresses strictly in rotation
order and does not advance past an unresolved round.

### 21.11 Sequential round order — frozen

Progression **must** strictly follow `roundNumber` order: round 1 → round
2 → … → round N. Round N cannot activate until round N−1 is `CLOSED`;
round N+1 is the **only** legal successor to round N; no skipping, no
activating an arbitrary `UPCOMING` round out of order, no multiple future
rounds activated at once. **Sequence authority is exclusively
`PayoutRound.roundNumber`** (persisted, frozen at activation, §1) — never
inferred from current `CircleMember.payoutOrder` (which cannot diverge
from `roundNumber` today, since post-activation membership is immutable,
§1, but is never the authority regardless, per this document's own
repeated discipline).

### 21.12 Close + next-activation atomicity — frozen

**For a non-final round, closing round N and activating round N+1 happen
atomically, in the same transaction, under the same `SavingsCircle` row
lock.** There must never be a successful partial state where N is
`CLOSED` and N+1 remains `UPCOMING` — no deliberate architectural reason
was found to justify one, and allowing it would reintroduce exactly the
"legitimate zero-ACTIVE-round mid-rotation" ambiguity §21.8 explicitly
rules out as corruption-only. **For the final round, closing it is the
entire operation** — `ACTIVE → CLOSED` with no successor activation,
since none exists. Both shapes are one atomic write (or write-pair) inside
one `prisma.$transaction`, matching every existing financial writer's own
proven "acquire lock → re-read fresh → CAS → roll back the whole
transaction on any failure" shape (§21.18).

### 21.13 Final round / circle-completion boundary — frozen

**Round lifecycle and circle completion remain conceptually and
operationally separate.** The lifecycle service closes the final round
and leaves `SavingsCircle.status` at `ACTIVE`; a separate, future
circle-completion service independently verifies every round `CLOSED`
and transitions `ACTIVE → COMPLETED`. Reasons, confirmed sound by this
audit: clean entity/state responsibility (a round-lifecycle writer never
touches `SavingsCircle.status`, exactly as every existing financial
writer already never does, §21.5); explicit, separately-attributable
circle-completion provenance (`completedAt`/`completedById` already exist
in schema, §21.2, ready for that future writer); no hidden circle
mutation as a side effect of what is, structurally, a `PayoutRound`-only
write.

**The temporary state this creates — `SavingsCircle.status === "ACTIVE"`
with every `PayoutRound.status === "CLOSED"` — is explicitly a valid,
expected pre-completion state**, not an error, not a state any read model
needs to guard against, and not one that requires urgent remediation by
any automatic process (none exists, and none is proposed, §21.14).

### 21.14 Who may advance a round — frozen

**Only the circle owner may initiate round-lifecycle progression, via an
explicit action.** Evaluated:

- **(A) Explicit owner "Advance round" action — frozen as the V1 rule.**
- **(B) Automatic closure the instant the financial predicate becomes
  true — rejected.** This would give `confirmPayout` (or, transitively,
  `confirmContribution` fulfilling a round's last obligation) a hidden
  `PayoutRound`-lifecycle side effect — directly contradicting this
  document's own already-frozen, already-shipped guarantee (7K.4/7K.5,
  reverified by direct source read in §21.5) that those services touch no
  round-lifecycle state at all. Adopting (B) now would require reopening
  and amending two already-frozen, already-shipped service contracts;
  (A) requires amending neither.
- **(C) Automatic system lifecycle based on reads/time — rejected**, for
  the identical reasons Option C is rejected in §21.7 (no scheduler
  exists; unanswerable actor provenance).

**Member authority: unchanged from what is already shipped** —
confirm/dispute their own payout only (7K.4/7K.5/7K.10); never round
lifecycle. **System authority: none** — the financial predicate becoming
true is a necessary condition for advancement to be *permitted*, never a
sufficient condition that *triggers* it on its own.

### 21.15 Actor provenance — SCHEMA GAP: migration recommended before implementation

**Decision: SCHEMA GAP — a migration adding `PayoutRound.closedById`
(nullable `String`, FK to `User`, identical shape to the existing
`activatedById`) is recommended before the lifecycle-implementation
ticket begins.** This reverses the earlier, more tentative framing in
§12 of this document (written before round lifecycle's own actor model
was frozen), which speculated the `activatedById`/no-`closedById`
asymmetry might reflect closure being "a derived, computed consequence"
with "no distinct actor decision to attribute." §21.14, frozen in this
same audit, settles that speculation the other way: **closure is now an
explicit, owner-triggered action** (Option A), not a passive derived
fact — so the same historical-accountability argument that justifies
`activatedById` applies equally to closure.

The gap is **not merely cosmetic** for one specific, real case: for a
**non-final** round, the actor who closed round N is always recoverable
without `closedById`, because §21.12 freezes close-N and activate-(N+1)
as the *same* atomic operation by the *same* actor at the *same*
instant — round (N+1)'s own `activatedById`/`activatedAt` already
carries that provenance, making a separate `closedById` on round N
redundant information for every non-final round. **But the final round
has no successor to activate, and therefore no other row anywhere that
could ever carry the identity of who closed it.** Without `closedById`,
the actor who closed a circle's last round becomes **permanently
unrecoverable** the moment that transaction commits — a genuine,
irreversible historical-fact loss, not a hypothetical one, and precisely
the kind of question this ticket's own instructions say must be settled
now rather than deferred "to save a ticket."

**Not decided here**: the exact migration SQL, and whether it should be
bundled with the lifecycle-implementation ticket's own PR or landed
narrowly beforehand as its own migration-only change (mirroring how prior
schema work in this codebase has been sequenced). Either is compatible
with this contract; 7K.11 itself creates no migration, per its own
explicit instruction.

**7K.12 implementation note** (factual, does not reopen this section's
own frozen reasoning above): `PayoutRound.closedById` now exists —
nullable `String`, FK to `User` (`"PayoutRoundCloser"` relation,
reciprocal `User.closedPayoutRounds`), `onDelete: Restrict`/
`onUpdate: Cascade`, identical shape and delete policy to
`activatedById`. Migration `20260910152621_add_payout_round_closed_by_
provenance` — purely additive (one nullable column, one foreign key), no
index, no data rewrite, no other table touched. **No historical backfill
was needed or attempted**: a live pre-migration audit of the configured
database found 47 persisted `PayoutRound` rows, all `UPCOMING`, all with
`closedAt`/`activatedAt` null — zero `CLOSED` rows, confirming this
document's own §21.3 prediction exactly. No `closedById` value was ever
inferred from `activatedById`, a recipient, an owner, or any other proxy;
none was needed. **No runtime round-lifecycle behavior exists after this
ticket** — `payoutRound.create` (activation) remains the only writer to
this table (re-confirmed by the same grep methodology as §21.3);
`activateFirstRound`/`advanceRound` do not exist. **
`assertActivatedRotationIntegrity` (`circle.service.ts`) is deliberately
left unchanged** — its `round.status !== "UPCOMING"` assumption remains
truthful until a lifecycle writer exists, and its relaxation is
intentionally deferred to the lifecycle-implementation ticket itself
(§21.3), not this schema-only one.

### 21.16 dueDate semantics — frozen

**`PayoutRound.dueDate` is historical/scheduling information only. It
gates nothing.** Confirmed by a codebase-wide grep for `new Date()`/
`Date.now()` across every domain/service module: no code anywhere
compares a round's `dueDate` (or `SavingsCircle.startDate`) against the
current date for any gating purpose, today or as part of this frozen
contract. `dueDate` may drive display (already does, throughout the
owner/member UI), and may drive reminders/lateness semantics in a future,
explicitly out-of-V1 feature (§21.26) — it does not gate contributions,
payouts, round closure, or round activation. An owner may legitimately
finish a round early, the instant all financial facts are complete, with
no dependency on whether `dueDate` has been reached — consistent with the
already-frozen 7J/7K recording rules this section extends rather than
narrows.

### 21.17 startDate semantics — frozen (explicit V1 product decision)

Current code leaves the relationship between `SavingsCircle.startDate`
and round activation **implicit** — no comment or contract anywhere
previously stated it outright. This audit makes it explicit: **`startDate`
is a schedule anchor used exclusively by `roundDueDate`
(`circle-rotation-schedule.ts`) to compute every round's `dueDate` at
activation time** (round 1's `dueDate` equals `startDate` exactly, by
construction — `roundDueDate` with `roundNumber = 1` has zero elapsed
intervals). **It is not an activation gate, and does not mean "round 1
auto-starts on this date"** — consistent with §21.7's rejection of
Option C and §21.16's finding that no date-comparison gating exists
anywhere in this codebase.

### 21.18 Concurrency model — frozen

All future lifecycle writers must: acquire the shared `SavingsCircle`
`FOR UPDATE` lock first (via the existing, unmodified
`lockSavingsCircleForUpdate`, §21.19); re-read every piece of
authoritative state (circle, round(s), obligations, payout) freshly under
that lock; validate the financial closure predicate (§21.9) under the
lock; CAS the round transition(s); never trust any pre-lock read as
current by the time the write happens. This is not a new discipline —
it is the identical shape every one of the seven existing financial/
structural writers (`activateCircle` plus the three contribution and
three payout writers) already independently implements.

Required race outcomes, audited explicitly:

| # | Race | Required outcome |
|---|---|---|
| 1 | Two concurrent attempts to advance the same round | Both resolve safely to the identical terminal state; exactly one fresh transition (first to acquire the lock); the second observes the already-CLOSED round + already-ACTIVE successor under its own lock acquisition and resolves as a safe replay (§21.21) |
| 2 | Advance current round vs. a late contribution confirmation for that round's last obligation | Whichever transaction acquires the lock first is authoritative; if the confirmation commits first, a subsequent advance attempt may then succeed (predicate now true); if advance acquires the lock first and finds an `OPEN` obligation, it fails safely (predicate incomplete) — no retry-and-wait, no partial write |
| 3 | Advance current round vs. payout confirmation | Same lock-order reasoning as #2; advance either succeeds (payout already CONFIRMED when it re-reads) or fails safely (payout still RECORDED) |
| 4 | Advance vs. payout dispute | If the round's payout is merely RECORDED, advance already fails on the predicate alone (RECORDED ≠ CONFIRMED) regardless of whether a concurrent dispute is also in flight — there is no window in which advance could succeed against a payout that is about to become DISPUTED; once DISPUTED commits, every future advance attempt fails safely and permanently (§21.10) |
| 5 | Advance vs. a future circle-completion call | Symmetric to #1 — both serialize through the same lock; whichever commits first is authoritative; the completion service must re-verify "every round CLOSED" fresh under its own lock acquisition, exactly as this section requires of every future writer |
| 6 | First-round activation attempted concurrently twice | Same shape as #1 — first commits; second observes round 1 already ACTIVE with consistent provenance under its own lock acquisition and resolves as a safe replay |

**No partial transitions, in any race**: because close-N/activate-(N+1)
(or activate-round-1) is one `prisma.$transaction` callback, any failed
check anywhere inside it rolls back every write already attempted inside
the same callback — there is no code shape by which N could end up
`CLOSED` while N+1 fails to activate, or vice versa.

### 21.19 Cross-service lock order — confirmed, no deviation found

All seven existing writers (`activateCircle`,
`recordContribution`/`confirmContribution`/`rejectContribution`,
`recordPayout`/`confirmPayout`/`disputePayout`) were directly re-confirmed,
by source grep, to call `lockSavingsCircleForUpdate` as their first
substantive step inside their own transaction, with **zero** deviation.
There is exactly one lock resource in this schema (the `SavingsCircle`
row) and every writer acquires it in the same, single order — no writer
ever holds two different circles' locks simultaneously, so no cross-circle
deadlock ordering concern applies either. **The future lifecycle service
must use the identical, unmodified `lockSavingsCircleForUpdate` primitive
from `circle-lock.repository.ts`** — no new lock table, no new lock
primitive, no per-round lock. Doing otherwise would be the one change
capable of introducing a genuine split-brain/deadlock risk this audit
found no other basis for.

### 21.20 Integrity / corruption-handling contract — frozen

**Preferred, uniform rule: fail with an explicit lifecycle integrity
error. Never repair silently, regenerate rounds, rewrite historical
financial rows, skip a corrupted round, or infer missing history** —
identical posture to every existing payout/contribution integrity check
in this document. Specific corruption classes a future lifecycle service
must detect and refuse, rather than paper over:

- Multiple `ACTIVE` rounds (§21.4/§21.8 — the read layer will not catch
  this; the write layer must never produce it and must refuse to operate
  if it ever finds it already persisted).
- No `ACTIVE` round where progression has begun but is incomplete
  (§21.8's corruption-only case #3).
- Duplicate or missing `roundNumber` values, or a missing successor round
  where §21.11 expects one to exist.
- A successor round already `ACTIVE`/`CLOSED` when the lifecycle service
  is about to activate it (a stale/corrupted precondition, not a replay —
  distinguished per §21.21).
- A recipient relation that fails to resolve (structurally near-
  impossible given the compound FK, §2, but never assumed away).
- Zero `ContributionObligation` rows for a round being evaluated for
  closure (mirrors `PayoutAccountingIntegrityError`'s own "empty
  obligation set" refusal, §5/§21.9 — never treated as vacuously
  fulfilled).
- A `FULFILLED` obligation whose ledger-derived confirmed-payment state
  disagrees with that status (§21.9's own projection-integrity check).
- A `CONFIRMED` payout with broken/incoherent provenance, or whose
  amount/currency no longer matches the round's frozen obligations
  (§21.9 — reusing `payout-owner-read.service.ts`'s own
  `assertPayoutIntegrity` check pattern, not a new one).

**Boundary between lifecycle service and existing accounting/read
helpers**: the lifecycle service **reuses** the existing domain functions
(`isObligationFulfilled`, `amountMatchesObligation`,
`computeExpectedPayoutAmount`, `amountMatchesExpectedPayout`) and the
existing repository query shapes (confirmed-payment sums, round
obligations) — it does not reimplement financial validation, only adds
the round-status CAS and the lifecycle-specific structural checks listed
above (round sequencing, successor state, ACTIVE-count) that no existing
service has any reason to already contain.

### 21.21 Idempotency / replay contract — frozen, no clientOperationId

**No `clientOperationId` is warranted.** Unlike payout/contribution
recording (which needs to distinguish "the same submission, retried" from
"a different financial intent" — an amount, an obligation, a reason —
that could genuinely vary between two calls), a round-lifecycle
transition has no variable intent to disambiguate: the operation's target
and outcome are fully determined by persisted round identity and
sequence. **Persisted round state itself provides sufficient natural
idempotency**, frozen as:

For `activateFirstRound({ ownerId, circleId })`:
- Round 1 already `ACTIVE`, with consistent provenance → safe, zero-write
  replay (return current state).
- Round 1 already `CLOSED` (progression has since continued normally) →
  **also** a safe, zero-write replay — the original intent ("round 1
  starts") was genuinely satisfied in the past; returning the round's
  true current (now historical) state is truthful, not an error.
- Any other observed state (e.g. round 2 `ACTIVE` while round 1 is still
  `UPCOMING`) → integrity conflict (§21.20), never guessed at.

For `advanceRound({ ownerId, circleId, roundId })`:
- `roundId` currently `ACTIVE`, predicate satisfied → fresh transition.
- `roundId` already `CLOSED` and its immediate successor is `ACTIVE` (or,
  for the final round, nothing else is `ACTIVE`) → **safe replay**
  (ticket's own explicit example, confirmed).
- `roundId` already `CLOSED` **and its successor is also `CLOSED`**
  (progression has moved further than this specific call's own moment) →
  **also a safe, zero-write replay of the historical fact "yes, `roundId`
  is closed"** — distinguished from an error precisely because the
  originally-requested transition did happen, just earlier than this
  particular stale call learned about it.
- `roundId` `CLOSED` but successor state inconsistent with either of the
  above (missing, still `UPCOMING` when it should be `ACTIVE`, etc.) →
  **integrity conflict, not replay** (ticket's own explicit example,
  confirmed).
- `roundId` is not the legitimate current round to advance at all (an
  arbitrary/out-of-sequence `roundId`, never having been `ACTIVE`) →
  **rejected outright as a sequence violation**, never silently treated
  as a replay of anything — this is the distinction this ticket asks for
  between "stale replay of a real past operation" and "invalid arbitrary
  transition."

### 21.22 Recommended API shape — not implemented

```
activateFirstRound({ ownerId, circleId }): AdvanceRoundResult
advanceRound({ ownerId, circleId, roundId }): AdvanceRoundResult
```

Two public operations, not three. `activateFirstRound` is justified as
its own operation (not folded into `advanceRound`) because it has a
structurally different shape — activate-only, no round to close — and
forcing it through `advanceRound`'s own signature would need an awkward
"no round to advance yet" case. `closeRound`/`activateNextRound` are
**explicitly not** exposed as two independent public operations — per
§21.12's own atomicity freeze, `advanceRound` performs both internally
(close `roundId`, then activate its successor if one exists) inside one
transaction, so no caller can ever invoke one half without the other.
`roundId` in `advanceRound` names the round being **closed** (the
currently-ACTIVE round the owner is choosing to advance past), not the
round being activated — its successor is derived, never separately
supplied, consistent with §21.11's own "successor is never caller-chosen"
rule.

### 21.23 Owner UI implication — contract only, not built

- No round `ACTIVE` and round 1 may start → "Start first round."
- Current round's financial predicate incomplete → show plainly why
  progression is blocked (which obligations remain `OPEN`, or that the
  payout is not yet `CONFIRMED`/is `DISPUTED`); never a fake success.
- Current round complete, non-final → "Close round & start next" (one
  control, matching the one atomic operation, §21.12/§21.22).
- Final round complete → "Close final round."
- Every round `CLOSED` → a future, separate "Complete circle" control
  (§21.13/§21.25) — not built by whichever ticket implements round
  lifecycle either, unless explicitly scoped to do so.

Status advancement must never become automatic merely because a page
renders — every transition above requires an explicit, intentional owner
click, per §21.14.

### 21.24 Member UI implication — confirmed compatible, unchanged

Members remain strictly read-only for round lifecycle: current round,
next round, closed rounds may be displayed (already are, §21.4), but no
lifecycle mutation control is ever shown to a member — already true today
(no such control exists, §21.10 of the 7K.10 deliverable independently
confirmed this structurally) and unaffected by anything this contract
freezes. The existing member dashboard's own current/next-round framing
(§21.4) remains fully compatible with every state this contract
introduces, including the two legitimate zero-ACTIVE states (§21.8),
without any code change.

### 21.25 Circle-completion contract handoff

**"Every persisted `PayoutRound.status === CLOSED`" is sufficient domain
authority for `SavingsCircle` `ACTIVE → COMPLETED`.** Because round
closure itself already requires (§21.9) every obligation `FULFILLED` and
the round's payout `CONFIRMED`, and because a `DISPUTED` payout
permanently prevents its own round's closure (§21.10) — "every round
CLOSED" already transitively implies "every obligation FULFILLED
circle-wide," "every payout CONFIRMED circle-wide," and "no unresolved
dispute anywhere." This reaffirms, rather than merely repeats, this
document's own earlier §13 conclusion, now with the full round-lifecycle
contract behind it rather than speculation ahead of it. A future
completion service **may** still perform a lightweight defense-in-depth
re-check (consistent with this codebase's universal "never blindly trust
one predicate status without re-verifying at the boundary" discipline),
but is **not required** to independently re-derive the full financial
predicate from scratch — round closure's own guarantees already establish
it. **Not implemented in 7K.11 or any ticket before it.**

### 21.26 V1 non-goals — reaffirmed, none introduced by this contract

Explicitly not introduced by this audit, matching the ticket's own list
verbatim: skipped rounds, paused rounds, reopened rounds, cancelled
rounds, replacement recipients, member default replacement, payout
correction, dispute resolution, grace periods, penalties, loans,
interest, partial payouts, partial obligations, automatic bank/mobile-
money execution, a scheduler or any background progression, notifications/
reminders. All remain future features, entirely outside this contract.

### 21.27 The 15 required decisions — summary

| # | Question | Frozen answer |
|---|---|---|
| 1 | First-round activation rule | **Option B** — activation leaves every round UPCOMING (unchanged); round 1's activation is a separate, explicit owner action (§21.7) |
| 2 | Exactly one ACTIVE round required? | At most one, always; exactly one only while progression is in flight; two enumerated legitimate zero-ACTIVE states (§21.8) |
| 3 | Who may advance lifecycle? | Owner only, explicit action; never automatic on financial-predicate completion, never time-driven (§21.14) |
| 4 | Exact facts that permit closing a round | Every obligation FULFILLED (ledger-re-derived) + payout CONFIRMED (accounting-re-verified); never dueDate, never REJECTED-attempt history (§21.9) |
| 5 | Does DISPUTED permanently block progression? | Yes — for its own round, and (as a corollary) for every round after it (§21.10) |
| 6 | Must progression be sequential by roundNumber? | Yes, strictly; roundNumber is the sole sequence authority (§21.11) |
| 7 | Are close-current + activate-next atomic? | Yes, one transaction, one lock acquisition; no exposed partial API (§21.12/§21.22) |
| 8 | What happens on the final round? | Close only, no successor activation (§21.12) |
| 9 | Is circle completion a separate operation? | Yes, explicitly deferred; "all rounds CLOSED" is sufficient authority for it (§21.13/§21.25) |
| 10 | Does dueDate gate anything? | No — display/scheduling only (§21.16) |
| 11 | Is startDate a mutation gate or schedule anchor? | Schedule anchor only, made explicit by this audit (§21.17) |
| 12 | Does the schema need closedById or another migration? | **Yes — `closedById` recommended before implementation** (§21.15); **added in 7K.12** (migration `20260910152621_add_payout_round_closed_by_provenance`) |
| 13 | Replay/idempotency contract | Natural idempotency from persisted round state; no clientOperationId (§21.21) |
| 14 | Lock/concurrency model required | Shared `SavingsCircle` lock, identical to all seven existing writers; six races audited explicitly (§21.18/§21.19) |
| 15 | Is "all rounds CLOSED" enough for eventual circle completion? | Yes, sufficient domain authority; an optional defense-in-depth re-check is permitted, not required (§21.25) |

**No unresolved P0/P1 architectural ambiguity remains.** The one
concrete action item this audit surfaces for the implementation ticket
(distinct from the frozen contract itself) is §21.3's
`assertActivatedRotationIntegrity` relaxation — required, scoped, and
not a design ambiguity.

### 21.28 7K.13 implementation note

**Status: implemented and tested.** This is the first factual note in
§21 describing runtime behavior that actually exists, rather than a
frozen contract awaiting implementation.

**Service API, exactly as shipped** (`src/services/round-lifecycle
.service.ts`) — matches §21.22's own recommendation verbatim:

```
activateFirstRound({ ownerId, circleId }): Promise<ActivateFirstRoundResult>
advanceRound({ ownerId, circleId, roundId }): Promise<AdvanceRoundResult>
```

Neither `closeRound` nor `activateNextRound` is exposed independently —
`advanceRound` performs both (close `roundId`, activate its derived
successor if one exists) inside one transaction, so no caller can ever
observe or produce a state where the current round is `CLOSED` and its
successor remains `UPCOMING`.

**Return shape** — one deliberate, documented deviation from §21.22's own
suggested literal-status shape, in favor of truthfulness (this document's
own repeated standard): `LifecycleRoundResult.status` is typed
`"ACTIVE" | "CLOSED"` rather than a fixed literal per field, because a
replay can truthfully observe a round that has progressed further than
the specific transition being reported (e.g. `activateFirstRound`
replaying after round 1 has since also been `CLOSED`, or `advanceRound`
replaying round N's own closure after round N+1 has since *also* closed)
— the result always reports the round's true current status, never a
value implied only by which operation was called.

**assertActivatedRotationIntegrity evolution** (`circle.service.ts`) —
split exactly as §21.3/ticket-section-6 required, not merely renamed:
`assertActivatedRotationStructureIntegrity` keeps every IMMUTABLE
activation-time check byte-for-byte as strict as before (cohort/round/
obligation counts, roundNumber↔payoutOrder↔recipient mapping, due-date
recurrence, each obligation's frozen amount/currency/dueDate) MINUS the
four round-lifecycle-state checks and the obligation-status-forever-OPEN
assumption; the round-lifecycle-state shape itself is delegated to the
new shared, pure `assertRoundLifecycleStateIntegrity`
(`src/domain/round-lifecycle.ts`) — the SAME function
`round-lifecycle.service.ts` calls for its own preconditions, so the two
callers cannot silently drift into different definitions of "a coherent
lifecycle state." `assertActivatedRotationIntegrity` itself keeps its
exact external contract (always throws `CircleActivationIntegrityError`,
same two call sites, same signature) — verified by a live regression test
that activates a circle, starts round 1, financially completes and
advances it, then calls `activateCircle` again and confirms the replay
succeeds without resetting any round/obligation row, and that a genuinely
corrupted obligation still correctly throws `CircleActivationIntegrityError`.
One additional, previously-unnoticed bug this same evolution fixed:
`activateCircle`'s own `serializeActivationResult` used to hard-code
every returned round's status as the literal `"UPCOMING"` — harmless
before any lifecycle writer existed, but a live lie the moment one did;
it now reports each round's true persisted status.

**Financial closure predicate implementation**: contribution readiness
re-derives each obligation's true fulfillment from the confirmed-payment
ledger (`isObligationFulfilled`, reused unchanged from
`contribution-accounting.ts`) rather than trusting
`ContributionObligation.status` — a persisted status that disagrees with
the ledger it is supposed to project is refused as
`RoundLifecycleIntegrityError`, never repaired. Payout readiness reuses
`computeExpectedPayoutAmount`/`amountMatchesExpectedPayout`
(`payout-accounting.ts`) against the round's frozen obligations, exactly
as `payout-owner-read.service.ts`/`payout-member-read.service.ts` already
do — no third, independently-reimplemented money-equality rule anywhere
in this codebase.

**Timestamp policy**: one authoritative `new Date()` per lifecycle
operation. For a non-final `advanceRound`, the closed round's `closedAt`
and the activated successor's `activatedAt` share the exact same
timestamp value — both halves are one atomic owner decision, not two
independently-clocked facts (verified live).

**Replay/idempotency**: no `clientOperationId` — natural idempotency from
persisted round identity/state, exactly as §21.21 froze, including the
"stale replay after further progression remains valid, but a successor
stuck `UPCOMING` behind an already-`CLOSED` current round is corruption"
distinction (both directions verified live).

**Concurrency evidence, all real PostgreSQL**: two concurrent
`activateFirstRound` calls on the same circle resolve to exactly one
physical transition; two concurrent `advanceRound` calls on the same
financially-complete round (both non-final and final) resolve to exactly
one physical close(+activate); `advanceRound` racing a late contribution
confirmation, a payout confirmation, and a payout dispute each resolve
safely in either lock-acquisition order, with the financial mutation
itself always succeeding and `advanceRound` never succeeding against a
payout that was not yet `CONFIRMED` at the moment either contender began;
and `advanceRound` for one round does not block or interfere with an
unrelated, legitimate financial writer for a different round.

**Lock order**: `round-lifecycle.service.ts` uses the identical,
unmodified `lockSavingsCircleForUpdate` primitive as all seven
pre-existing writers — no new lock primitive, no new deadlock ordering
risk (§21.19's own required consistency, verified by source inspection).

**No hidden side effects**: verified both structurally (the service's own
source contains no reference to `ContributionPayment`/`ContributionObligation`/
`Payout` writes, `CircleMember` writes, or any `SavingsCircle` field
including `completedAt`/`completedById`) and live (a full row/field
snapshot of every unrelated table before and after `activateFirstRound`
is byte-identical).

### 21.29 7K.14 implementation note

**Status: implemented and tested.** Server Actions now exist for both
7K.13 operations, in the same testable-core + thin-`"use server"`-wrapper
shape as every other financial action in this codebase (`record-payout.ts`
/ `payout.actions.ts` is the closest precedent):

```
src/actions/activate-first-round.ts   -- runActivateFirstRoundAction (core)
src/actions/advance-round.ts          -- runAdvanceRoundAction (core)
src/actions/round-lifecycle.actions.ts -- activateFirstRoundAction / advanceRoundAction ("use server")
src/actions/round-lifecycle.state.ts  -- initialActivateFirstRoundState / initialAdvanceRoundState
src/validations/round-lifecycle.schema.ts -- advanceRoundSchema (roundId only)
```

**Auth**: both actions authenticate exclusively via `requireUser()`
(owner identity), deferred via dynamic `import()` exactly like
`record-payout.ts`/`activate-circle.ts` — never `requireCircleMember`.
`ownerId` comes only from that call; a forged `ownerId` field in the form
is never read.

**Input whitelist**: `activateFirstRound` accepts only `circleId` (raw,
non-empty-after-trim check, no schema — mirrors `activate-circle.ts`'s own
single-field handling). `advanceRound` accepts `circleId` (same raw check)
plus `roundId` (validated through `advanceRoundSchema`, an exact copy of
`payout.schema.ts`'s own roundId primitive per this codebase's established
"small per-domain copy over cross-domain import" convention). Verified
live by hostile-FormData tests: every forged lifecycle/financial field
(`status`, `activatedAt`, `activatedById`, `closedAt`, `closedById`,
`nextRoundId`, `isFinalRound`, `memberId`, `recipientId`, `payoutOrder`,
`startDate`, `dueDate`) is captured and asserted absent from what actually
reaches the service.

**Replay truthfulness**: a service-reported `replayed: true` always
surfaces as `status: "success"`, reporting the round's true current state
— never downgraded to an error, for any of `activateFirstRound`'s or
`advanceRound`'s replay shapes (including a final-round replay and a
replay after further progression).

**Error mapping** — "not ready" (ordinary, waitable) kept strictly
distinct from "integrity failure" (never waitable/fixable), exactly as
this ticket required:

| Error | Copy |
|---|---|
| `RoundLifecycleCircleNotFoundError` / `RoundLifecycleAuthorizationError` | "We could not find this circle." (collapsed, existing privacy pattern) |
| `RoundLifecycleRoundNotFoundError` | "We could not find this payout round." |
| `RoundLifecycleNotCurrentError` | "Only the circle's current round can be advanced." |
| `RoundLifecycleCircleNotActiveError` (first-round) | "This circle cannot start its rounds right now." |
| `RoundLifecycleCircleNotActiveError` (advance) | "This circle is not active, so its rounds cannot be advanced right now." |
| `RoundLifecycleContributionsIncompleteError` | "All contributions for this round must be confirmed before it can be closed." |
| `RoundLifecyclePayoutMissingError` | "The payout must be recorded and confirmed before this round can be closed." |
| `RoundLifecyclePayoutNotConfirmedError` | "The recipient still needs to confirm the payout." |
| `RoundLifecyclePayoutDisputedError` | "This payout was disputed, so this round cannot advance in NIA." (never "fix"/"retry"/"resolve" — verified by a live forbidden-word test) |
| `RoundLifecycleIntegrityError` / `PayoutAccountingIntegrityError` | "We couldn't safely {start/advance} this round because its saved records are inconsistent." (`error.message` itself is never surfaced — unlike some payout actions, since this ticket specified exact alternate copy) |

**Success wording**: `"Round <n> is active."` (first round, `<n>` always
derived from the service's own result, not hardcoded), `"Round <n> is now
active."` (non-final advance), `"The final round is closed."` (final
advance) — none ever say "circle complete"/"SUSU completed"/"savings
circle finished"; `isFinalRound` is exposed as a fact about sequencing
only. Verified by a live test asserting the final-closure message
contains none of those forbidden words.

**Revalidation scope (audited, not guessed)**: both actions revalidate
**both** `/circles/${circleId}` (owner) **and** `/member/circles/${circleId}`
(member) on success — a deliberate difference from `recordPayoutAction`'s
owner-route-only precedent. Rationale: `circle-member-dashboard.service.ts`
calls `selectCurrentAndNextRound` against live `PayoutRound.status`, so a
round-lifecycle transition changes what every member's own dashboard
resolves as its current/next round (before `activateFirstRound`, no round
is current at all; each `advanceRound` moves which round is current and
whose obligation is open) — this is member-visible state, not only an
owner-facing one, so revalidating only the owner route would leave members
looking at a stale round.

**No UI**: no owner or member page/component was touched. A structural
test (`round-lifecycle-ui-isolation.test.ts`) asserts none of
`page.tsx`/`active-circle-summary.tsx`/`contribution-desk.tsx`/
`payout-desk.tsx` (owner) or `page.tsx`/`member-dashboard.tsx`/
`member-payout-card.tsx` (member) reference any new action/state
identifier.

**No schema change, no completion logic**: verified structurally (no
Prisma import, no `round-lifecycle.repository`/`circle-lock.repository`
import, no `requireCircleMember`, no `completedAt`/`completedById`
reference) in both the two testable cores and the thin wrapper.

### 21.30 7K.15 implementation note

**Status: implemented and tested.** The owner-facing round-lifecycle READ
model now exists:

```
getOwnerRoundLifecycle({ ownerId, circleId }): Promise<OwnerRoundLifecycleResult>
```

(`src/services/round-lifecycle-owner-read.service.ts`). Pure read: no
lock, no write, no call into `activateFirstRound`/`advanceRound` "to
check" — a dry-run-by-catching-errors approach would risk mutating on
success, which this ticket explicitly forbade.

**Lifecycle scope decision (ticket section 5, stated explicitly)**:
**ACTIVE-only.** This is narrower than `getOwnerCirclePayouts`'s own
ACTIVE/COMPLETED/ARCHIVED scope, deliberately: that read answers "what
permanently happened" (true forever), while this read answers "what
transition may happen next" (meaningless once a circle can no longer
transition). Mirrors `getActiveCircleSummaryForOwner`'s own ACTIVE-only
scope instead. DRAFT/CANCELLED are rejected the same way every other
owner read rejects them (no `PayoutRound` rows exist pre-activation);
COMPLETED/ARCHIVED are rejected with the same
`OwnerRoundLifecycleCircleNotEligibleError`.

**7K.13 reuse, not duplication (ticket section 21)** — the central
architectural decision of this ticket. Two pure predicates that used to
live only inside `round-lifecycle.service.ts`'s own private
`assertContributionsReadyToClose`/`assertPayoutReadyToClose` were
extracted, unchanged in substance, into `src/domain/round-lifecycle.ts`:

- `assessContributionClosureReadiness(obligations): "READY" | "INCOMPLETE"`
- `assessPayoutClosureReadiness(payout, recipientId, expected): "MISSING" | "NOT_CONFIRMED" | "DISPUTED" | "READY"`

Both throw the new `RoundLifecycleFinancialIntegrityError` for a
corruption case (a persisted status disagreeing with its own ledger, a
CONFIRMED payout with drifted amount/currency/provenance, an empty
obligation set, an unrecognized payout status), and return a plain
classification for every ordinary "not ready yet" business state.
`round-lifecycle.service.ts` was refactored to call these two functions
and re-wrap their thrown error as its own `RoundLifecycleIntegrityError`
(exactly the same pattern it already used for
`RoundLifecycleStateIntegrityError`) and to translate each classification
into its own specific thrown error — its own external contract
(exception types, ordering, messages) is byte-for-byte unchanged, verified
by rerunning `round-lifecycle.service.test.ts` (56 tests) unmodified
after the refactor: all 56 still pass. `round-lifecycle-owner-read
.service.ts` calls the exact same two functions to CLASSIFY (never
throw-to-decide) the current round's progression for display. Neither
module reimplements the other's rule.

Read-side repository reuse is similarly direct, not duplicated:
`findCircleForRoundLifecycle`, `findObligationsForLifecycleRound`,
`findConfirmedPaymentSumsForLifecycle`, and `findPayoutForLifecycleRound`
(all from `round-lifecycle.repository.ts`, 7K.13) are called as-is,
passing the bare `prisma` client (no lock needed for a read). The only
genuinely new repository function is
`findRoundsForOwnerRoundLifecycle` (`round-lifecycle-owner-read
.repository.ts`) — the write side's own round select has no reason to
carry the recipient's owner-facing display fields (`displayName`,
`memberCode`) this read needs, per this codebase's established
per-consumer-select discipline.

**Phase model** — `NOT_STARTED` (every round `UPCOMING`, `nextRound` =
persisted round 1, `START_FIRST_ROUND`), `IN_PROGRESS` (exactly one
`ACTIVE` round, `currentRound`/`nextRound` derived solely from persisted
`roundNumber`/`status`, never date/payoutOrder), `ALL_ROUNDS_CLOSED`
(every round `CLOSED`, `circle.status` still reads `"ACTIVE"`,
`transitionKind: "AWAIT_CIRCLE_COMPLETION"` — never reported as
`COMPLETED`/"circle complete," preserving §21.13's own frozen boundary).

**Blocker precedence** (ticket section 10, verified against the actual
7K.13 order): contribution readiness is checked before payout readiness,
exactly matching `advanceRound`'s own call order
(`assertContributionsReadyToClose` before `assertPayoutReadyToClose`).

**Corruption is never a blocker** (ticket section 11): every one of the 11
manufactured-corruption tests (multiple `ACTIVE` rounds, invalid
`roundNumber` sequence, out-of-order `CLOSED`, `ACTIVE` predecessor not
`CLOSED`, missing `closedAt`/`closedById`/`activatedAt`/`activatedById`,
invalid `UPCOMING` provenance, `FULFILLED`-without-ledger-support,
`OPEN`-despite-confirmed-payment, `CONFIRMED`-payout amount/currency/
recipient/timestamp/dispute-provenance drift) throws
`OwnerRoundLifecycleIntegrityError`, never a `progression.blocker` value.
One case from the ticket's own list — a `Payout.recordedById` of empty
string — is DB-unreachable and untestable live: `recordedById` carries a
real foreign key to `User`, so Postgres itself rejects an empty value;
`round-lifecycle.service.test.ts` (7K.13) never exercises this branch
live either, for the identical reason. The defensive check remains in the
shared domain predicate as dead-but-harmless code, matching the existing
service's own posture.

**Transition kind** (ticket section 14): frozen as "describe the eventual
legal transition even when blocked" — `ADVANCE_TO_NEXT_ROUND` for a
non-final current round, `CLOSE_FINAL_ROUND` for a final one, regardless
of `canAdvanceCurrentRound`, so a future UI can label the correct action
without reconstructing final-round logic itself.

**Historical/date authority**: `currentRound`/`nextRound` recipient
identity comes only from `PayoutRound.recipientId`'s own persisted
relation — verified live by scrambling every member's `payoutOrder` after
activation and confirming the reported recipient is unchanged.
`dueDate`/`startDate` (past or future) are returned for display only and
never gate `canStartFirstRound`/`canAdvanceCurrentRound`/`blocker` —
verified live with a dueDate of `2099-01-01` on a financially-incomplete
round still reporting `CONTRIBUTIONS_INCOMPLETE`, and again reporting
`canAdvanceCurrentRound: true` once genuinely fulfilled despite the same
far-future date.

**Query count** (ticket section 19): 2 queries (`circle`, `rounds`) for
`NOT_STARTED`/`ALL_ROUNDS_CLOSED`; at most 5 for `IN_PROGRESS` (+
obligations, confirmed-payment sums, payout — all scoped to the ONE
current round, never any other round). Verified structurally (each of the
five read functions has exactly one call site in the service's own
source, and no loop calls any of them) and live (an 8-member circle
resolves with the identical shape/correctness as a 3-member one).

**7K.13 alignment regression** (ticket section 38, the most important
cross-layer evidence): five paired live tests assert the read model's
`progression.blocker`/`canAdvanceCurrentRound` for a given persisted state
agrees exactly with what `advanceRound` itself does against the identical
state — `CONTRIBUTIONS_INCOMPLETE` ↔ `RoundLifecycleContributionsIncompleteError`,
`PAYOUT_MISSING` ↔ `RoundLifecyclePayoutMissingError`,
`PAYOUT_NOT_CONFIRMED` ↔ `RoundLifecyclePayoutNotConfirmedError`,
`PAYOUT_DISPUTED` ↔ `RoundLifecyclePayoutDisputedError`, and
`canAdvanceCurrentRound: true` ↔ a genuine `advanceRound` success. The
read projection cannot drift from the mutation contract without one of
these five tests failing.

**Privacy/safe shape**: explicit Prisma selects only; a live test asserts
the full serialized JSON never contains `pinHash`, `credentialVersion`,
`failedPinAttempts`, `lockedUntil`, `session`, `tokenHash`,
`clientOperationId`, `recordedById`, `confirmedByMemberId`,
`disputedByMemberId`, or `payoutOrder`; an exact-`Object.keys` test locks
the top-level/`progression`/round/recipient shape.

**No UI, no mutation**: no owner or member page/component was touched (no
`app/` file appears in this ticket's diff at all); structurally verified
that this service contains no `prisma.*.create/update/updateMany/delete/
upsert`, no transaction, and no reference to
`activateFirstRound`/`advanceRound`/any Server Action.

### 21.31 7K.16 implementation note

**Status: implemented and tested.** The owner circle workspace now
exposes round-lifecycle progression, wired to the 7K.15 read and 7K.14
actions exactly as frozen — no new lifecycle rule of any kind exists in
this UI layer.

**Files added**: `app/(app)/circles/[circleId]/round-lifecycle-card.tsx`
(server component), `round-lifecycle-controls.tsx` (`"use client"`,
`StartFirstRoundForm`/`AdvanceRoundForm`), `round-lifecycle-display.ts`
(pure copy-mapping helpers: `getBlockerMessage`, `getAdvanceCtaLabel`),
plus their four test files. `page.tsx` was extended (not restructured):
`getOwnerRoundLifecycle` joins the existing ACTIVE-branch `Promise.all`
(now 4 reads, same pattern), and `<RoundLifecycleCard>` is rendered
between `<ActiveCircleSummary>` and `<ContributionDesk>` (the placement
this ticket's own section 5 asked for). `active-circle-summary.tsx`,
`contribution-desk.tsx`, `payout-desk.tsx`, and every member-route file
are untouched.

**Read-authority boundary**: `round-lifecycle-card.tsx` renders *only*
from `lifecycle.phase`/`currentRound`/`nextRound`/`progression` — it
never receives (and therefore cannot inspect) `ContributionPayment`/
`ContributionObligation`/`Payout` data; `ContributionDesk`/`PayoutDesk`
remain separate siblings with their own, unrelated read models on the
same page. Verified structurally (source-grep for `ContributionPayment`,
`payout.status`, `confirmedAt`, `.every(`, `.filter(`, `.reduce(` — none
present in either the card or its controls) and by construction (the
component's own props carry no such data at all).

**Phase rendering**, exactly per the frozen 7K.15 model, no independent
eligibility logic added: `NOT_STARTED` shows round 1's persisted
recipient/date and a `StartFirstRoundForm` gated only by
`progression.canStartFirstRound`; `IN_PROGRESS` shows the current (and,
if any, next) round from their own persisted fields, the blocker message
(`getBlockerMessage`) only when `progression.blocker` is set, and
`AdvanceRoundForm` only when `progression.canAdvanceCurrentRound`;
`ALL_ROUNDS_CLOSED` states every round is closed and that "the circle has
not yet been marked complete in NIA" — never rendering any lifecycle
control, and never claiming `SavingsCircle.status` is `COMPLETED`.

**Action wiring**: `StartFirstRoundForm` submits `circleId` only, to
`activateFirstRoundAction`; `AdvanceRoundForm` submits `circleId` +
`currentRound.id` only, to `advanceRoundAction` — the same single action
for both the non-final-advance and final-round-closure cases (no
`closeFinalRoundAction` was created; the service already owns that
distinction via `transitionKind`). Both forms use the established
`initialActivateFirstRoundState`/`initialAdvanceRoundState`. Neither form
computes CTA eligibility; `getAdvanceCtaLabel` only maps an
already-decided `transitionKind` plus two display-only round numbers to a
label string.

**Wording discipline**, verified by both pure-function tests
(`getBlockerMessage`/`getAdvanceCtaLabel`) and source-grep on the
components: `PAYOUT_DISPUTED`'s copy contains none of fix/retry/resolve/
override/refund/adjudicate; the final-round CTA and its supporting copy
contain none of complete/finish/archive; dates are labeled "Scheduled
date," never phrased as a start/collection trigger; no date
(`dueDate`/`startDate`/`Date.now()`) gates any control.

**No circle completion**: grepped across every new/changed file for
`completeCircle`/`completeSavingsCircle`/`archiveCircle`/`completedAt`/
`completedById` — none present.

**Member isolation**: `src/actions/round-lifecycle-ui-isolation.test.ts`
(originally 7K.14's "no UI at all" guard) was extended, not replaced —
it now separately asserts (a) the four untouched/near owner files never
reference the raw action identifiers directly, and (b) all three member
route files never reference the action identifiers, the new component
names, or their CTA copy ("Start round 1," "Close final round," "Close
round").

**Test methodology** (reported precisely, per this ticket's own section
46): `round-lifecycle-display.test.ts` runs genuine pure-function unit
tests (real `getBlockerMessage`/`getAdvanceCtaLabel` invocations, real
assertions on their return values) — no DOM/browser rendering. Every
other new/changed test file (`round-lifecycle-controls.test.ts`,
`round-lifecycle-card.test.ts`, `page.test.ts`'s additions, the extended
isolation guard) is a structural/source-regex test reading the actual
`.tsx`/`.ts` source text — the same established methodology as every
prior UI ticket in this sequence (`record-payout-form.test.ts`,
`active-circle-summary.test.ts`, etc.). No React Testing Library, no
jsdom, and no real browser session was exercised for any component in
this ticket; a manual live check (`pnpm build` + route compilation) is
the only end-to-end evidence gathered.

**No 7K.13/7K.14/7K.15 contract change**: none was needed or made. This
ticket found no mismatch between what the read model exposes and what the
UI needed to render.

## Verification

- `pnpm lint`: clean.
- `pnpm build`: succeeds.
- `pnpm prisma validate`: schema valid.
- `pnpm prisma migrate status`: database up to date, no pending
  migrations.
- `git diff --check`: clean.
- No application code, schema, or test was changed to produce or amend
  this document, at either the original audit or the 7K.1 sign-off —
  verified by `git status` showing only this file.

**TICKET 7K — SUSU PAYOUT WORKFLOW DOMAIN AUDIT: COMPLETE**

**TICKET 7K.1 — PAYOUT V1 CONTRACT SIGN-OFF: COMPLETE**

**TICKET 7K.11 — ROUND LIFECYCLE AUDIT & V1 CONTRACT: READY FOR
IMPLEMENTATION** — see §21. Documentation/architecture only; no schema,
service, repository, action, UI, or test was changed to produce this
section, verified by `git status` showing only this file for this
ticket's own diff. One schema gap was found and its resolution frozen
(§21.15: `closedById` recommended before implementation) — this is a
decision, not a blocker; 7K.11 itself creates no migration, per its own
explicit instruction.

**TICKET 7K.12 — ROUND CLOSURE PROVENANCE PERSISTENCE: COMPLETE** — see
§21.15's own implementation note. `PayoutRound.closedById` now exists
(migration `20260910152621_add_payout_round_closed_by_provenance`,
purely additive, no backfill needed or attempted — verified live, zero
historical `CLOSED` rows). No round-lifecycle runtime behavior was
implemented; `assertActivatedRotationIntegrity` was deliberately left
unchanged, per this ticket's own explicit instruction.

**TICKET 7K.13 — ROUND LIFECYCLE SERVICES: COMPLETE** — see §21.28's own
implementation note. `activateFirstRound`/`advanceRound` now exist and
are fully tested, including real-PostgreSQL concurrency evidence for six
distinct races. No Server Action, UI, or schema change; circle completion
remains a separate, unimplemented future operation, exactly as §21.13/
§21.25 froze.

**TICKET 7K.14 — ROUND LIFECYCLE SERVER ACTIONS: COMPLETE** — see
§21.29's own implementation note. `activateFirstRoundAction`/
`advanceRoundAction` now exist, owner-authenticated, input-whitelisted,
and fully tested (behavioral tests for both cores, structural tests for
the thin wrapper and for UI isolation). No UI, schema, or completion logic
was added; circle completion remains a separate, unimplemented future
operation, exactly as §21.13/§21.25 froze.

**TICKET 7K.15 — OWNER ROUND LIFECYCLE READ MODEL: COMPLETE** — see
§21.30's own implementation note. `getOwnerRoundLifecycle` now exists,
ACTIVE-only, reusing (never duplicating) 7K.13's own repository reads and
two newly-extracted shared domain predicates
(`assessContributionClosureReadiness`/`assessPayoutClosureReadiness`,
`src/domain/round-lifecycle.ts`). `round-lifecycle.service.ts` itself was
refactored to call those same two functions with its 56-test external
contract verified unchanged. No UI, Server Action, schema, or mutation was
added; circle completion remains a separate, unimplemented future
operation, exactly as §21.13/§21.25 froze.

**TICKET 7K.16 — OWNER ROUND LIFECYCLE UI: COMPLETE** — see §21.31's own
implementation note. The owner circle workspace now renders round
progression (`RoundLifecycleCard`) between `ActiveCircleSummary` and
`ContributionDesk`, reading exclusively from `getOwnerRoundLifecycle`
(7K.15) and mutating exclusively through `activateFirstRoundAction`/
`advanceRoundAction` (7K.14) — no new eligibility, financial, or
date-gating logic was introduced anywhere in the UI layer. Member routes
remain untouched and isolated by an extended structural guard. No
circle-completion behavior was added; the circle remains ACTIVE (never
rendered as completed) once all rounds are closed, exactly as §21.13/
§21.25 froze.
