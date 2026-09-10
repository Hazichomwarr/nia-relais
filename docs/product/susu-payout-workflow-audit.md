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
- **7K.9** — Owner payout-recording UI.
- **7K.10** — Recipient confirm/dispute UI.
- **7K.11** — Live concurrency verification (§11), mirroring 7J.9's own
  dedicated concurrency-guard ticket for contributions.
- **Separately, not part of this sequence** — round-lifecycle
  transitions (§12) and circle completion (§13), confirmed by 7K.1 as
  their own future lifecycle slice, deliberately not a prerequisite for
  any 7K payout-writer ticket.

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
