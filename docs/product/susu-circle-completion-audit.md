# SUSU Circle Completion — Domain Audit & V1 Contract (7L)

Companion document to `susu-payout-workflow-audit.md`. Split out into its
own file per this ticket's own instruction (section 33) — that document's
§21 (round lifecycle) has already grown to 31 subsections, and circle
completion is a distinct enough concern (a `SavingsCircle`-level terminal
transition, not a `PayoutRound`-level one) to warrant its own home rather
than further overloading §21. Every cross-reference below to "§21.N" or
"§N" without a filename refers to `susu-payout-workflow-audit.md`.

This is an **audit and V1 contract only** — no service, repository,
Server Action, UI, schema, or migration is created by this ticket, per
its own explicit instruction. Every "frozen" decision below is a
documentation-only decision for a future implementation ticket to build
against, exactly like §21 (7K.11) was for round lifecycle before 7K.13
implemented it.

## 1. Persistence audit

`prisma/schema.prisma`'s `SavingsCircle` model (verified by direct
inspection, not assumed):

```prisma
model SavingsCircle {
  id      String @id @default(cuid())
  ownerId String
  owner   User   @relation("CircleOwner", fields: [ownerId], references: [id], onDelete: Restrict)

  name               String
  currency           String                @db.Char(3)
  contributionAmount Decimal               @db.Decimal(18, 2)
  frequency          ContributionFrequency
  startDate          DateTime
  status             CircleStatus          @default(DRAFT)
  activatedAt        DateTime?
  activatedById      String?
  activatedBy        User?                 @relation("CircleActivator", fields: [activatedById], references: [id], onDelete: Restrict)
  completedAt        DateTime?
  completedById      String?
  completedBy        User?                 @relation("CircleCompleter", fields: [completedById], references: [id], onDelete: Restrict)
  archivedAt         DateTime?
  archivedById       String?
  archivedBy         User?                 @relation("CircleArchiver", fields: [archivedById], references: [id], onDelete: Restrict)
  ...
}

enum CircleStatus {
  DRAFT
  ACTIVE
  COMPLETED
  CANCELLED
  ARCHIVED
}
```

**Finding: no schema gap exists.** `completedAt`/`completedById` (and,
separately, `archivedAt`/`archivedById`) already exist, nullable, with
`onDelete: Restrict` on their `User` relations — identical shape to
`activatedAt`/`activatedById`, and identical shape to `PersonalGoal`'s
own `completedAt`/`completedById`/`archivedAt`/`archivedById` (verified:
`PersonalGoal` carries the exact same four-field pattern). `Restrict`
means a `User` who ever completes a circle can never be deleted while
that provenance reference exists — permanent historical provenance,
matching every other actor field in this schema (`recordedById`,
`confirmedByMemberId`, `disputedByMemberId`, `activatedById`,
`closedById`, ...). **No migration is needed for V1 circle completion.**

`PayoutRound` (re-confirmed, unchanged since 7K.12/7K.13):
`status`/`activatedAt`/`activatedById`/`closedAt`/`closedById` all
already exist with the same `Restrict` provenance discipline;
`@@unique([circleId, roundNumber])` and `@@unique([circleId,
recipientId])` remain the structural invariants a future completion
predicate can lean on unchanged.

`ContributionObligation`/`ContributionPayment`/`Payout`/`CircleMember`:
inspected, unchanged from the 7K/7J audits — no field relevant to
completion is missing from any of them.

## 2. Existing-writer audit

Grepped every production reference to `savingsCircle.update`/
`savingsCircle.updateMany` and every reference to `status:`/
`completedAt`/`completedById`/`archivedAt`/`archivedById` in
`src/repositories/circle.repository.ts` (the only file that ever writes
`SavingsCircle`):

- `createDraftCircleRecord` — creates a `DRAFT` row, explicitly writing
  `activatedAt: null, activatedById: null, completedAt: null,
  completedById: null, archivedAt: null, archivedById: null`.
- `markCircleActive` — the **only** writer of `status`/`activatedAt`/
  `activatedById` anywhere in the codebase: a CAS `updateMany({ where:
  { id, status: "DRAFT" }, data: { status: "ACTIVE", activatedAt,
  activatedById, completedAt: null, completedById: null, archivedAt:
  null, archivedById: null } })`. It defensively re-nulls the
  completion/archive fields (already null coming from `DRAFT`, but
  explicit rather than assumed).

**No writer anywhere sets `status` to `COMPLETED`, `CANCELLED`, or
`ARCHIVED`, and no writer anywhere sets `completedAt`/`completedById`/
`archivedAt`/`archivedById` to a non-null value.** This is genuinely
greenfield — confirmed, not assumed.

**`CANCELLED` is dead code today.** It exists in the enum (and in the
very first migration, `20260624032600_init`) and is referenced in test
fixtures/type unions for exhaustiveness (`circle-member-session.service
.test.ts`, `payout-owner-read.service.test.ts`, several `type
CircleStatus = "DRAFT" | "ACTIVE" | ... | "CANCELLED"` test-local type
aliases) and in a handful of read-model comments reasoning about "a
`CANCELLED` circle never activates either" — but **no writer in this
codebase has ever set it, and no draft-cancellation feature exists**.

**`PersonalGoal` precedent, read but not mechanically copied** (per this
ticket's own instruction): `goal-completion.service.ts`
(`completePersonalGoal`) locks the goal row, checks owner, checks
`status !== "ARCHIVED"`, replays if already `COMPLETED`, evaluates a
**target/date-based** eligibility rule (`savedAmount >= targetAmount`
`AND` `today >= unlockDate`), CAS-updates via a dedicated
`completeActivePersonalGoal` repository function, and re-reads on a CAS
miss to resolve a race as replay-or-conflict. The **lock → owner check →
terminal-status replay → eligibility check → CAS update → re-read-on-miss
→ replay-or-conflict** *shape* is directly reusable for SUSU completion
(it is the same shape every SUSU financial/lifecycle writer already
uses); the eligibility *rule itself* is not reusable at all, since SUSU's
completion trigger is structural (every round `CLOSED`), not
target/date-based. `goal-archive.service.ts` is a genuinely **separate**
service from goal completion — `archivePersonalGoal` requires `status
!== "ACTIVE"` (i.e., the goal must already be `COMPLETED`) before it can
be archived. This is direct precedent for keeping SUSU completion and
archive as two separate, sequential, never-conflated operations (see §16
below).

## 3. Completion authority

**Frozen: OWNER ONLY**, identical to every other SUSU mutation in this
codebase (`activateCircle`, `recordContribution`/`confirmContribution`/
`rejectContribution`, `recordPayout`, `activateFirstRound`/
`advanceRound`). No product document, ticket, or existing service
anywhere suggests a member/recipient may complete a circle merely by
being a participant or a round's recipient — member authority in this
codebase is scoped exclusively to `confirmPayout`/`disputePayout` for
their *own* round's payout (7K.1 sign-off item 4), never to
circle-level state. **No platform-admin override** exists anywhere in
this codebase for any SUSU or Personal Savings operation (`goal
-completion.service.ts` itself has none either) — none is introduced
here.

## 4. Completion must be explicit — Option B confirmed

Validated against 7K.11–7K.16, no contradiction found:

- §21.7 (7K.11, frozen, implemented by 7K.13 as `activateFirstRound`)
  already established the precedent that a SUSU lifecycle transition
  requiring an owner's deliberate intent is **never** inferred from a
  date, a read, a login, or financial activity — it happens only via an
  explicit call. Round closure/advancement (`advanceRound`) is likewise
  always an explicit owner call, never automatic.
- No scheduler, cron, or background-job infrastructure exists anywhere in
  this codebase (confirmed by the same grep 7K.11 §21.7 already
  performed when evaluating Option C for first-round activation — still
  true, nothing has added one since).
- 7K.16's own `RoundLifecycleCard` explicitly renders `"The circle has
  not yet been marked complete in NIA"` once every round is `CLOSED` —
  already product-copy-committing to completion being a **separate,
  future, explicit act**, not something that happens the instant the
  final round closes.

**Frozen: Option B — explicit owner action, after all rounds are
`CLOSED`.** Options A (automatic on final-round-close) and C
(time-driven) are both rejected, for the identical reasons §21.7 already
rejected them for first-round activation: an owner must be able to see
and deliberately confirm a terminal, permanent state change, and no
time-driven infrastructure exists to build C on even if it were
desired. This does **not** reopen or alter the round lifecycle itself —
`activateFirstRound`/`advanceRound` remain exactly as 7K.13 built them.

## 5. Completion precondition — Option B (revalidate) frozen

**The question**: is `SavingsCircle.status === ACTIVE AND every
persisted PayoutRound.status === CLOSED` alone sufficient authority, or
should completion defensively re-verify financial closure invariants for
every round?

**7K.1 sign-off item 10 (quoted in full, `susu-payout-workflow-audit.md`
line ~160)**:

> **10. Circle completion.** Not implemented here (still true). The
> intended eventual rule is frozen as documentation only: **circle
> completion requires every round to be `CLOSED`.** Because `CLOSED`
> itself already requires every obligation `FULFILLED` and the payout
> `CONFIRMED` (item 8), those two financial predicates do not need to be
> duplicated as independently-checked completion authority if round
> closure is implemented correctly ... **This reduction must be
> re-audited when circle completion is actually implemented, not assumed
> correct from documentation alone.**

**Re-audit result: the reduction is CONFIRMED true against the actual
7K.13 implementation**, not merely the 7K.1 prediction. Direct code
inspection of `round-lifecycle.service.ts`'s `advanceRound` (the only
writer of `PayoutRound.status → CLOSED`) shows the CAS write to `CLOSED`
is only ever reached after `assertContributionsReadyToClose` (now
`assessContributionClosureReadiness`, extracted 7K.15) and
`assertPayoutReadyToClose` (now `assessPayoutClosureReadiness`) both pass
— which require every obligation ledger-fulfilled and the round's payout
`CONFIRMED` (never merely `RECORDED`, never `DISPUTED` — a `DISPUTED`
payout can never reach `CONFIRMED`, so a disputed round can never close,
confirming item 10's own transitive claim about disputes too). So
**logically**, "every round `CLOSED`" already implies every financial
predicate item 10 named.

**But logical sufficiency of the persisted-`CLOSED`-status claim is a
different question from whether completion should *trust* that
persisted status without re-deriving it — and this audit freezes
**Option B: revalidate**, for reasons distinct from the logical-reduction
question above:

1. **This is the one discipline this entire codebase has applied
   everywhere else, without exception**: "never trust a persisted status
   alone — re-derive from the ledger" is stated or applied literally in
   `contribution-accounting.ts` (`isObligationFulfilled`), every owner/
   member read model (`contribution-owner-read.service.ts`,
   `payout-owner-read.service.ts`, `round-lifecycle-owner-read.service
   .ts`), and `round-lifecycle.service.ts` itself. A `PayoutRound.status
   === "CLOSED"` label is exactly the kind of persisted status this
   codebase otherwise never trusts blindly. Trusting it uncritically only
   at the single most consequential, terminal, hardest-to-reverse
   mutation in the entire SUSU domain would be the one inconsistency in
   an otherwise uniform architecture.
2. **Raw DB corruption is the one thing "every round CLOSED" (checked as
   a bare status filter) cannot detect**, and §26 below names concrete,
   plausible examples (a `CLOSED` row missing `closedById`, a confirmed
   payout with a drifted amount, a broken round sequence) that a bare
   `WHERE status = 'CLOSED'` count would silently accept. Every one of
   these is exactly the class of corruption `assertRoundLifecycleStateIntegrity`
   (structural) and `assessContributionClosureReadiness`/
   `assessPayoutClosureReadiness` (financial) already exist specifically
   to catch — reusing them at completion costs nothing new to build.
3. **Performance is not a real objection here.** Unlike a read model
   rendered on every page load (`round-lifecycle-owner-read.service.ts`
   deliberately queries only the *current* round for exactly that
   reason), circle completion is a **one-time, rare, owner-initiated,
   already-lock-holding** mutation. Paying an O(rounds) cost once, at the
   moment a circle is permanently sealed, is the correct trade — not the
   same trade a per-request read model must make.
4. **No genuine architectural precedent favors trusting the bare status
   instead.** `activateCircle`'s own `assertActivatedRotationIntegrity`
   already re-verifies immutable activation-time structure on every
   subsequent read/activation replay, not just at the original write —
   the codebase's precedent is consistently "re-verify," never "trust and
   move on."

**Frozen precondition** (full predicate a future `completeCircle` must
implement):

```
SavingsCircle.status === "ACTIVE"
AND rounds.length >= 2                              (assertRotationSequenceIntegrity)
AND roundNumbers form the exact sequence 1..N        (assertRotationSequenceIntegrity)
AND every round's lifecycle-state provenance coherent (assertRoundLifecycleStateIntegrity)
AND every round.status === "CLOSED"                  (the completion-specific predicate)
AND, for every round: assessContributionClosureReadiness(...) === "READY"
AND, for every round: assessPayoutClosureReadiness(...) === "READY"
```

The first three structural checks and the "every round CLOSED" check
answer §6 below; the last two financial re-checks answer this section's
own Option B choice, and reuse — never reimplement — the exact functions
`round-lifecycle.service.ts`/`round-lifecycle-owner-read.service.ts`
already both call (`src/domain/round-lifecycle.ts`). A future
completion repository should batch these across **all** rounds in as few
queries as `payout-owner-read.repository.ts`'s own established pattern
already proves possible (one query for every round, one for every
obligation across the whole circle, one for every payout across the
whole circle — never one round-trip per round), not
`round-lifecycle.repository.ts`'s single-current-round pattern (which
exists for a different, per-request-cost-sensitive consumer).

## 6. Round-count / structural integrity — reuse frozen

**Frozen: yes, completion must call the exact same pure lifecycle
structural validator** round-lifecycle write (7K.13) and read (7K.15)
already both call —
`assertRotationSequenceIntegrity`/`assertRoundLifecycleStateIntegrity`
(`src/domain/round-lifecycle.ts`, framework-free, already proven to
independently verify: at least two rounds; exact `1..N` sequence with no
gap/duplicate; per-round provenance coherence — an `UPCOMING` round
carries no activation/closure provenance, an `ACTIVE` round carries
activation but not closure provenance, a `CLOSED` round carries both;
and the three-phase forward-only shape that makes "every round CLOSED"
one of exactly three legitimate zero-`ACTIVE` shapes, the other two being
"every round UPCOMING" and the impossible-once-any-round-has-closed mix).
This is **the same function** `circle.service.ts`'s own
`assertActivatedRotationIntegrity` and `round-lifecycle.service.ts`'s own
`assertLifecycleStateIntegrity` already wrap in their own named error —
completion would do the identical wrap-in-a-`CircleCompletion`-named-error
pattern, never a fourth independently-drifting copy of this logic.

The completion-specific addition on top (not something the shared
validator does, since it has no opinion on "and it must currently ALL be
`CLOSED`" — that is a completion-only predicate, not a general
lifecycle-shape rule) is the plain `rounds.every(r => r.status ===
"CLOSED")` check, exactly mirroring how `round-lifecycle-owner-read
.service.ts` already derives its own `ALL_ROUNDS_CLOSED` phase.

## 7. Completion provenance

On success: `SavingsCircle.status: ACTIVE → COMPLETED`, set
`completedAt` (server-authoritative `new Date()`, see §8) and
`completedById = ownerId`.

**`activatedAt`/`activatedById` must already be present and coherent** —
audited: `markCircleActive` is the only writer of `status → ACTIVE`, and
it always sets both non-null in the same CAS write (never one without
the other); every subsequent read (`getActiveCircleSummaryForOwner`)
already requires `!circle.activatedAt` to reject as
`ActiveCircleOwnerReadNotActiveError`. A `status === "ACTIVE"` circle
with a null `activatedAt`/`activatedById` would itself be a genuine,
independent corruption signal (unreachable via any known writer, but a
future completion service should not silently proceed past it either —
worth an explicit, named integrity check at implementation time, distinct
from the round-lifecycle checks in §6).

**`archivedAt`/`archivedById` must never be touched by completion** — a
`COMPLETED` circle is not yet `ARCHIVED` (§16); completion writes
exactly the three completion-provenance fields (`status`, `completedAt`,
`completedById`) and nothing else on `SavingsCircle`, and writes **no**
`PayoutRound`/`ContributionObligation`/`ContributionPayment`/`Payout`
field at all — round provenance is permanent and frozen the moment each
round closed (7K.13), and completion must never rewrite it.

## 8. Timestamp authority

**Frozen: `completedAt` is its own fresh, server-authoritative `new
Date()`, captured once, inside the locked transaction, at the moment
completion itself commits** — identical policy to every other SUSU
timestamp in this codebase (`activatedAt`, `closedAt`,
`recordedAt`/`confirmedAt`/`disputedAt`). It must **never** be derived
from the final round's own `closedAt`, the payout's `confirmedAt`, the
last obligation's `fulfilledAt`, `circle.startDate`, or any round's
`dueDate` — even when closing the final round and completing the circle
happen within the same second (an owner clicking "Close final round"
immediately followed by "Mark circle complete"), these remain **two
distinct explicit historical events with two distinct timestamps and two
distinct actor-provenance records**, exactly as §21.19's own "one
authoritative transition instant per atomic event" principle already
established for the *separate* concern of "both halves of one
`advanceRound` call share one timestamp" — completion is a **different**
event, never folded into that one.

## 9. Completion replay / idempotency

No `clientOperationId` is needed — natural idempotency from persisted
circle identity/status, exactly the same shape `activateFirstRound`
already uses (a round/circle either already reflects the intended
outcome, or it doesn't).

**Frozen contract:**

- **Fresh**: `status === "ACTIVE"` and the full §5 predicate holds →
  `ACTIVE → COMPLETED`, one write.
- **Exact replay**: `status === "COMPLETED"` already, with coherent
  `completedAt`/`completedById` provenance (both non-null, `completedById`
  a real actor) → return the persisted completed state, **zero writes**,
  `replayed: true` — mirrors `activateFirstRound`/`advanceRound`'s own
  "replay before/without the lock" pattern exactly.
- **Same-owner replay is the only legitimate replay shape.** Ownership is
  re-verified (`circle.ownerId === callerOwnerId`) on every call,
  including a replay — `SavingsCircle.ownerId` is written exactly once,
  at creation (`createDraftCircleRecord`), and **never updated by any
  writer anywhere in this codebase** (grepped, confirmed — see §18). A
  completed circle's `completedById` can therefore **only ever equal**
  the circle's own permanent `ownerId`, by construction: nothing else
  could have called `completeCircle` successfully in the first place,
  since the authorization check (§3) already requires
  `circle.ownerId === callerOwnerId` on the ORIGINAL completing call too.
  A completed circle whose `completedById` does **not** match
  `circle.ownerId` is therefore **impossible by the model** in the
  absence of corruption — and if it is ever observed, it is a genuine
  integrity contradiction (ownership immutability itself violated),
  never treated as "a different owner's replay," because no such
  legitimate concept exists in this model at all.
- No replay path may regenerate `completedAt`/`completedById` — a replay
  always returns the row's original, first-written completion
  provenance, never a fresh timestamp.

## 10. Terminal-state operation table

| Operation | ACTIVE behavior | COMPLETED behavior | Reason |
|---|---|---|---|
| `addDraftCircleMember`/`removeDraftCircleMember`/`setDraftCirclePayoutOrder` | N/A — these require `status === "DRAFT"` (`assertDraftOwner`, `circle.service.ts`) | Same rejection as today, unchanged — `COMPLETED` is not `DRAFT` either | These already gate on `DRAFT` specifically, not merely "not `ACTIVE`" — no code change needed, no new gap |
| `activateCircle` | The one and only fresh path (`DRAFT → ACTIVE`) | N/A — a `COMPLETED` circle was never `DRAFT` again; `assertDraftOwner` still rejects it identically | No change |
| `recordContribution` | Fresh recording allowed (item 3, 7K.1-equivalent contribution freeze) | **Fresh blocked** (`circle.status !== "ACTIVE"` → `ContributionRecordingCircleNotActiveError`); exact `clientOperationId` replay still succeeds (resolved *before* the `ACTIVE` check, unconditionally) | Existing, unmodified 7J.2 contract — verified in source, not assumed |
| `confirmContribution`/`rejectContribution` | Fresh decision allowed | Fresh decision blocked (same `ACTIVE` gate); a `CONFIRMED`/`REJECTED` terminal replay "must succeed even if the circle has since become `COMPLETED` or `ARCHIVED`" (verbatim from `contribution-confirmation.service.ts`'s own doc comment) | Existing, unmodified 7J.3 contract |
| `recordPayout` | Fresh recording allowed | Fresh blocked; exact-intent replay survives `COMPLETED`/`ARCHIVED` (verbatim doc comment) | Existing, unmodified 7K.3 contract |
| `confirmPayout`/`disputePayout` | Fresh decision allowed | Fresh blocked; terminal (`CONFIRMED`/`DISPUTED`) replay survives `COMPLETED`/`ARCHIVED` (verbatim doc comments in both files) | Existing, unmodified 7K.4/7K.5 contract |
| `activateFirstRound`/`advanceRound` | Fresh transition allowed (requires `ACTIVE`) | Fresh transition impossible — completion's own precondition already requires every round `CLOSED`, so no `UPCOMING`/`ACTIVE` round remains to transition; a stale call would resolve as ordinary replay (already-`CLOSED`/already-`ACTIVE` round found) exactly per 7K.13's own existing replay rules, needing **zero** new code | No change; already correct by construction (§15) |
| Member login / session issuance | Allowed | **Already allowed** — `ELIGIBLE_CIRCLE_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"]` in `circle-member-session.service.ts` | Pre-existing, verified in source |
| `getCircleMemberDashboard` (member read) | Allowed | **Already allowed** — same eligible-status set in `circle-member-dashboard.service.ts` | Pre-existing |
| `getCircleMemberPayouts` (member read) | Allowed | **Already allowed** — same set in `payout-member-read.service.ts` | Pre-existing |
| `getActiveCircleSummaryForOwner` | Allowed | **Rejected** (`status !== "ACTIVE"` → `ActiveCircleOwnerReadNotActiveError`) | ACTIVE-only by design (7I.6) — genuine follow-up gap, see §14/§27 |
| `getOwnerCircleContributions` | Allowed | **Rejected** (`status !== "ACTIVE"` → `OwnerContributionsCircleNotActiveError`) | ACTIVE-only by design (7J.5) — genuine follow-up gap |
| `getOwnerCirclePayouts` | Allowed | **Already allowed** — `ELIGIBLE_CIRCLE_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"]` (7K.7) | Pre-existing, deliberately permanent-history-scoped |
| `getOwnerRoundLifecycle` | Allowed | **Rejected** (`status !== "ACTIVE"` → `OwnerRoundLifecycleCircleNotEligibleError`) | ACTIVE-only by design (7K.15, this session) — expected; a completed circle has nothing left to progress |
| `/circles/[circleId]` (owner route) | Renders active workspace | **404s today** (see §27) — the *page's own* data loader calls the two ACTIVE-only reads above before ever reaching `getOwnerCirclePayouts` | Genuine, concrete follow-up gap — not a completion-service concern, a future UI-ticket concern |
| `/member/circles/[circleId]` | Renders dashboard | **Already works unmodified** (see §13/§28) | Every read it depends on already accepts `COMPLETED` |

## 11. Post-completion contribution behavior

Categorized per this ticket's own A/B/C/D framing, using
`recordContribution`/`confirmContribution`/`rejectContribution`'s actual
source (not assumed):

- **A. Fresh financial mutations** (a genuinely new `clientOperationId`
  intent, or a fresh confirm/reject decision on a still-`RECORDED`
  payment): **must become impossible** once `status !== "ACTIVE"` —
  already true today for any non-`ACTIVE` status, unconditionally, with
  no code change needed for `COMPLETED` specifically to also be covered
  (the existing check is `!== "ACTIVE"`, not `=== "DRAFT" || ===
  "CANCELLED"`).
- **B. Exact idempotent replay** (same `clientOperationId`, same intent,
  `recordContribution`): **must remain possible** — already resolved
  unconditionally, before the `ACTIVE` check, per the service's own
  explicit doc comment ("a legitimate retry ... must succeed even if the
  circle is no longer ACTIVE").
- **C. Terminal decision replay** (`confirmContribution`/
  `rejectContribution` observing an already-`CONFIRMED`/`REJECTED`
  payment): **must remain possible** — already resolved unconditionally,
  before the `ACTIVE` check, per the service's own explicit doc comment
  ("must succeed even if the circle has since become COMPLETED or
  ARCHIVED").
- **D. Historical reads**: **must remain possible** — `getOwnerCirclePayouts`
  already supports it; `getOwnerCircleContributions` currently does not
  (§14 follow-up).

**Frozen: none of B/C/D may ever be blocked by a future completion
service or by completion having occurred.** Completion changes
`SavingsCircle.status` only — it must never gate, wrap, or otherwise
touch any contribution service's own existing replay contract, and this
audit confirms no contribution service would need to change for
completion to ship correctly.

## 12. Post-completion payout behavior

Identical structure, verified against `payout-recording.service.ts`/
`payout-confirmation.service.ts`/`payout-dispute.service.ts`'s own
source:

- **Fresh `recordPayout`**: already blocked once `status !== "ACTIVE"` —
  no change needed.
- **Exact-intent replay of `recordPayout`** (same `clientOperationId`):
  **remains valid** — resolved before the `ACTIVE` check, doc comment:
  "become COMPLETED or ARCHIVED and after the payout has been terminally
  [decided]."
- **`confirmPayout`/`disputePayout` terminal replay** (`CONFIRMED`/
  `DISPUTED` already persisted): **remains valid** — both files' own doc
  comments state this explicitly for `COMPLETED`/`ARCHIVED`.
- **Fresh `confirmPayout`/`disputePayout`** (payout still `RECORDED`):
  already blocked once `status !== "ACTIVE"`. (In practice this is
  additionally unreachable post-completion for a different, structural
  reason too — completion's own precondition requires every round's
  payout already `CONFIRMED`, so no `RECORDED` payout can exist anywhere
  in a `COMPLETED` circle in the first place, absent corruption.)

**Frozen: no payout service requires any change for completion to ship
correctly** — this audit found the contracts already exactly right.

## 13. Member access after completion

Confirmed by direct source inspection (not inferred): `circle-member
-session.service.ts` (`ELIGIBLE_CIRCLE_STATUSES = new Set(["ACTIVE",
"COMPLETED", "ARCHIVED"])`, checked both at session issuance and at every
subsequent session re-validation), `circle-member-dashboard.service.ts`
(identical set), and `payout-member-read.service.ts` (identical set,
`isEligibleCircleStatus`) **already** treat `COMPLETED` (and `ARCHIVED`)
as fully eligible. `require-circle-member.ts`'s own doc comment states
this plainly: *"the circle's current status is one of
ACTIVE/COMPLETED/ARCHIVED (DRAFT and CANCELLED excluded by omission)."*

**Frozen, confirmed (not assumed): members may continue to log in, view
their historical dashboard, view contribution history, and view their
own payout state after `COMPLETED`, with zero code changes required.**
This was already built correctly, ahead of completion actually existing
— no follow-up needed on the member side.

## 14. Owner read access after completion

| Read model | Scope today | Operational-only or historical-accounting? | Gap? |
|---|---|---|---|
| `getActiveCircleSummaryForOwner` (7I.6) | `ACTIVE`-only | Genuinely operational (frozen terms, live member/round orientation while progressing) — arguably fine to stop serving it post-completion, since nothing about it is "historical accounting" | Not a gap by itself, but see the page-level consequence below |
| `getOwnerCircleContributions` (7J.5) | `ACTIVE`-only | **Historical-accounting** — every contribution ever made is a permanent record | **Gap**: an owner cannot review their own circle's contribution history once completed |
| `getOwnerCirclePayouts` (7K.7) | `ACTIVE`/`COMPLETED`/`ARCHIVED` | Historical-accounting | **No gap** — already correct |
| `getOwnerRoundLifecycle` (7K.15) | `ACTIVE`-only | Genuinely operational (progression eligibility) — correctly has nothing left to say once `COMPLETED` | Not a gap; arguably *should* stay `ACTIVE`-only forever, since a completed circle has no lifecycle decision left to make |
| `/circles/[circleId]` route | Assembles all of the above | — | **The real, user-facing gap** (see §27): the page 404s entirely today once `COMPLETED`, because its own data loader calls the two `ACTIVE`-only reads (summary, contributions) *unconditionally* in the same branch that also fetches the payout/lifecycle reads, with no `COMPLETED`-aware branch of its own |

**Required follow-up, explicitly listed (not implemented here)**: a
future ticket must (a) extend `getOwnerCircleContributions` to accept
`COMPLETED`/`ARCHIVED` (mirroring `getOwnerCirclePayouts`'s own already-
correct scope, since contribution history is exactly as permanent a
record as payout history), and (b) give `/circles/[circleId]`'s own data
loader a genuine `COMPLETED` branch — presumably a historical-summary
view built from `getOwnerCirclePayouts`/the extended contributions read,
*not* `getActiveCircleSummaryForOwner`/`getOwnerRoundLifecycle` (both of
which have no reason to ever serve a completed circle). This is a **P1
finding**: completion must not ship its own mutation without this
follow-up also being scheduled, or an owner who completes their own
circle immediately loses their own page.

## 15. Round lifecycle after completion

**Frozen: no round transition of any kind after `COMPLETED`.** Verified
against `activateFirstRound`/`advanceRound`'s actual existing source: both
require `circle.status === "ACTIVE"` on their fresh path; both resolve a
requested round that is already `ACTIVE`/`CLOSED` as an ordinary,
pre-existing replay, *before* even reaching that `ACTIVE` check. Since
completion's own precondition (§5) requires every round already
`CLOSED`, there is no `UPCOMING` round left for `activateFirstRound` to
find (it would resolve via its own existing "round 1 already
`ACTIVE`/`CLOSED` → replay" branch) and no `ACTIVE` round left for
`advanceRound` to find (any call would hit the pre-existing
`RoundLifecycleNotCurrentError`/replay paths, depending on which round id
is supplied) — **both already behave exactly as this ticket requires,
with zero new code**. No `CLOSED → ACTIVE` or `COMPLETED → ACTIVE`
transition is introduced or possible.

## 16. Completion vs. archive

**Frozen: never conflated.** `COMPLETED` means the rotation finished
successfully and the circle remains part of the owner's normal
historical workspace; `ARCHIVED` (candidate semantics) means the owner
later chooses to remove a completed circle from their default/working
view without destroying any history — directly mirroring
`goal-archive.service.ts`'s own precedent, where `archivePersonalGoal`
requires the goal to already be non-`ACTIVE` (i.e., already
`COMPLETED`) and is a wholly separate service/operation from
`completePersonalGoal`.

**Frozen: Option B — completion ships (once implemented); archive is
deferred to a later, post-V1-freeze ticket.** Reasoning: this ticket's
own scope explicitly excludes archival; `SavingsCircle.archivedAt`/
`archivedById` already exist in the schema (§1) so no migration blocks
deferring archive; the `PersonalGoal` precedent already demonstrates
archive can be built as a clean, later, additive service without needing
to be co-designed with completion; and no product requirement in this
audit's own scope demands archive ship simultaneously. Option A
(archive required before Phase 7 freeze) and Option C (both must be
designed together) are both rejected — not because archive is
unimportant, but because nothing here demonstrates it is *urgent*
relative to shipping completion itself, and deferring it costs nothing
(the schema is already ready for it).

## 17. `CANCELLED` enum handling

**Frozen, explicitly**:
- `CANCELLED` cannot become `COMPLETED` in V1 (a future completion
  service's own precondition already requires `status === "ACTIVE"`,
  which structurally excludes `CANCELLED` without needing a dedicated
  check).
- `COMPLETED` cannot become `CANCELLED` (no writer of `CANCELLED` exists
  or is introduced; no reverse-transition of any kind exists for
  `COMPLETED` in this model).
- **No cancellation path is introduced by this audit or is in scope for
  the eventual completion ticket.** `CANCELLED` remains exactly what §2
  found it to be today: a legacy, dead enum value with zero writers,
  referenced only in exhaustiveness-style type unions and read-model
  rejection lists (every owner/member read that enumerates eligible
  statuses already correctly excludes it "by omission," per
  `require-circle-member.ts`'s own comment) and one unrelated
  `GoalCustodianStatus`/`CustodianAssignment` `"CANCELLED"` value that is
  a completely different enum on a completely different model
  (`custodian.repository.ts`/`custodian.service.ts`, Personal Savings
  domain) and must not be confused with `CircleStatus.CANCELLED`.

## 18. Circle ownership mutability

**Frozen: `SavingsCircle.ownerId` is immutable in practice.** Grepped
every reference to `ownerId` in `circle.repository.ts` (the sole writer
of `SavingsCircle`) and every other repository/service in this
codebase: `ownerId` is written exactly once, at `createDraftCircleRecord`
time, and **never appears on the left-hand side of any subsequent
`update`/`updateMany` call anywhere**. No ownership-transfer feature
exists, is planned, or is implied by any other 7K/7J/7I ticket. **The
completion actor is therefore necessarily the circle's one, permanent,
original owner** — this is not a design choice this audit is making, it
is an observed fact about the existing, unmodified data model. No
transfer support is invented here, per this ticket's own instruction.

## 19. Completion return shape (conceptual)

Following this codebase's own established safe-serialization convention
(`ActivateFirstRoundResult`/`AdvanceRoundResult`, 7K.13) — never a raw
Prisma object, only plain serialized primitives:

```
CircleCompletionResult = {
  readonly circleId: string;
  readonly status: "COMPLETED";
  readonly completedAt: string;      // ISO 8601
  readonly completedById: string;
  readonly replayed: boolean;
}
```

`completedById` is included (unlike, say, a member-facing read that
deliberately omits actor ids) because every existing **owner-facing**
result in this codebase already exposes actor ids freely
(`ActivateFirstRoundResult.activatedById`,
`AdvanceRoundResult.closedRound.closedById`) — the owner is always
allowed to see who (among owner-only actors) performed an owner-only
action on their own circle; there is no privacy boundary being crossed,
since `completedById` can only ever equal the caller's own `ownerId`
(§9). This is a **conceptual** freeze for a future ticket to implement
against, not a shipped type.

## 20. Error model (conceptual)

Following the exact naming/collapsing conventions already established by
`round-lifecycle.service.ts`/`round-lifecycle-owner-read.service.ts`:

- `CircleCompletionNotFoundError` — circle does not exist. Collapsed with
  authorization for privacy (existing pattern).
- `CircleCompletionAuthorizationError` — exists, but caller is not the
  owner. Collapsed with not-found at the action boundary (existing
  pattern).
- `CircleCompletionNotActiveError` — circle is not currently `ACTIVE`
  (still `DRAFT`, already `COMPLETED` is handled separately as replay,
  or is `ARCHIVED`/`CANCELLED`) — an **ordinary, waitable/expected**
  state for `DRAFT`, but note a `COMPLETED` circle is never routed
  through this error (it is a replay, not a "not active" failure).
- `CircleCompletionRoundsIncompleteError` — circle is `ACTIVE`, every
  round is structurally coherent, but not every round is `CLOSED` yet —
  the **one** ordinary "not ready" business state for this operation
  (unlike round advancement, there is only one predicate here, not four,
  since completion has no "which specific financial fact is missing"
  granularity to report — it is binary: rotation finished, or not).
- `CircleCompletionIntegrityError` — **anything** structurally or
  financially incoherent: a broken round sequence, missing provenance, a
  `CLOSED` round whose re-verified financial facts (§5 Option B) no
  longer check out. **Never** collapsed into
  `CircleCompletionRoundsIncompleteError` — corruption must never be
  reported as "just not ready yet," per this ticket's own explicit
  instruction and this codebase's own established
  not-ready-vs-integrity discipline (7K.13/7K.14/7K.15/7K.16 all draw
  this exact line already).

## 21. Concurrency / locking

**Frozen: the identical, unmodified `lockSavingsCircleForUpdate`
primitive** (`circle-lock.repository.ts`) every other SUSU writer already
uses — `SELECT ... FOR UPDATE` on the `SavingsCircle` row, acquired
inside `prisma.$transaction`, before any read or write of circle-scoped
state. No new lock primitive, no new deadlock-ordering risk.

Races a future implementation must prove safe (valid outcomes only,
no code written here):

- **A. `completeCircle` vs. final `advanceRound`** — see §22, analyzed
  separately as the most important race.
- **B. `completeCircle` vs. `completeCircle`** — see §23 (double
  completion).
- **C. `completeCircle` vs. contribution replay** (`confirmContribution`/
  `rejectContribution` terminal replay, or `recordContribution` exact
  replay) — both operations resolve their own replay **before** taking
  the circle lock at all (§11), so there is no lock contention to
  reason about in the first place; whichever runs, runs, and neither
  writes anything new. Valid outcome: both succeed independently,
  circle's `status` is unaffected by either.
- **D. `completeCircle` vs. payout replay** — identical reasoning to C
  (§12); no lock contention, both succeed independently.
- **E. `completeCircle` vs. member login/read** — member reads
  (`circle-member-session.service.ts`, `circle-member-dashboard.service
  .ts`, `payout-member-read.service.ts`) take **no** circle lock at all
  (confirmed: none of them import `lockSavingsCircleForUpdate`) — they
  are plain, lock-free reads. Valid outcome: a member's read either
  observes the circle still `ACTIVE` (pre-completion) or already
  `COMPLETED` (post-completion); both are individually eligible statuses
  for every member read (§13), so there is no failure mode here at all,
  only which of two equally-valid answers a concurrent read happens to
  observe.
- **F. `completeCircle` vs. any fresh financial mutation** — see §24/§25;
  this audit concludes the race is **not actually reachable** by the
  time completion's own precondition could ever hold.

## 22. Final-round race (the critical one)

`advanceRound(final)` and `completeCircle` both acquire the **same**
`SavingsCircle` row lock, so they are strictly serialized against each
other — one always fully commits (or fully rolls back) before the other
begins its own locked section.

- **If `completeCircle` locks first while the final round is still
  `ACTIVE`**: its own re-verified predicate (§5, "every round `CLOSED`,"
  re-checked *inside* the lock, exactly like every other SUSU writer
  re-checks fresh state after acquiring the lock) finds the final round
  not yet `CLOSED` → **fails with `CircleCompletionRoundsIncompleteError`**
  (an ordinary, expected outcome, not a race bug). The owner may then
  legitimately call `advanceRound` to close the final round, and later
  retry `completeCircle`.
- **If `advanceRound(final)` locks first**: it closes the final round
  (exactly as 7K.13 already does, unmodified) and releases the lock.
  `completeCircle`, locking afterward, now finds every round `CLOSED` and
  **succeeds**.
- **No single transaction may ever both close the final round and
  complete the circle** — the current direction (this audit) keeps them
  as two separate, explicit owner actions with two separate lock
  acquisitions, exactly mirroring how `activateFirstRound` and the first
  round's own later closure are two separate acts, never bundled. This
  is a deliberate freeze, not an oversight: an owner should be able to
  *see* "the final round is closed" (7K.16's own existing UI copy)
  before separately, deliberately choosing to mark the whole circle
  complete — automatic chaining would silently reintroduce the "Option
  A: automatic completion" this audit already rejected in §4.

## 23. Double-completion race

Two concurrent owner completion attempts, same owner (the only
legitimate case, per §9): both lock the same row; the database
serializes them. Expected, frozen outcome — identical shape to every
other SUSU CAS writer's own proven double-call behavior
(`activateFirstRound`'s own "two concurrent calls resolve to exactly one
physical transition" test, `advanceRound`'s identical proof): exactly one
physical `ACTIVE → COMPLETED` transition happens; the second caller's own
CAS write affects zero rows, re-reads fresh state inside the same
transaction, finds `status === "COMPLETED"` with coherent provenance, and
resolves as a **replay** — same `completedAt`/`completedById` the first
call produced, never a regenerated timestamp, never a second write of
any kind.

## 24. Completion vs. fresh financial mutation

**This audit's conclusion: the race, as posed, is not actually
reachable.** Reasoning, chained from §5's own precondition and §25's own
proof:

Completion can only ever succeed once **every** round is `CLOSED`. But a
"fresh" (non-replay) financial mutation targeting any given round is
already made impossible the moment *that round itself* closes — not by
anything completion does, but by pre-existing, independent invariants
(§25): a `CLOSED` round's obligations are all `FULFILLED` (so
`recordContribution` already refuses a fresh attempt with
`ContributionObligationAlreadyFulfilledError`, entirely independent of
`SavingsCircle.status`), and its payout is already `CONFIRMED` (so
`recordPayout` is already blocked by `Payout`'s own
`@@unique([roundId])`, and `confirmPayout`/`disputePayout` have no
`RECORDED` payout left to act on fresh). Therefore: **by the time every
round is `CLOSED` (completion's own trigger condition), there is no
round left anywhere in the circle that could still accept a fresh
financial write in the first place** — the two events (every round
closing, and financial mutation becoming impossible for that round) are
not sequential-and-racing, they are the **same** event, already proven by
7K.13's own closure predicate. There is no narrow window for outcome "A"
or "B" (as the ticket poses them) to actually occur, because the
precondition for the race (a fresh writer targeting an already-fully-
rotated circle) cannot coexist with completion's own precondition. **No
revalidation of "anything after such a writer" is needed, because no
such writer can exist at the moment completion's predicate holds.**

## 25. Closed round does not freeze the ledger — verified sufficient

Each named example, verified against actual service source:

- **"New contribution attempt on an obligation already `FULFILLED`"** —
  already blocked: `recordContribution` throws
  `ContributionObligationAlreadyFulfilledError` for exactly this case,
  entirely independent of round or circle status.
- **"Payout recording on a round already having a payout"** — already
  blocked at the **database level**: `Payout.@@unique([roundId])` makes
  a second row structurally impossible regardless of any service logic
  at all.
- **"Reject/confirm replay"** — already safe: both are terminal-decision
  replays (§11/§12), explicitly designed to be idempotent no-ops that
  never mutate anything already-decided.

**Frozen conclusion: existing service invariants (obligation-status
guard, `Payout`'s own unique constraint, and confirm/reject's own
one-way terminal state machine) are already fully sufficient — this
audit found no genuine hole.** Nothing needs patching before completion
can safely ship; this is stated as a finding, not patched here, per this
ticket's own instruction.

## 26. Raw DB corruption

Ties directly back to §5's Option B choice. For each named example:

| Corruption | Caught by structural check (§6) alone? | Caught only by financial revalidation (§5 Option B)? |
|---|---|---|
| Circle `ACTIVE`, all rounds `CLOSED`, one `CLOSED` round missing `closedById` | **Yes** — `assertRoundLifecycleStateIntegrity`'s own per-round provenance check | — |
| Broken round sequence (gap/duplicate `roundNumber`) | **Yes** — `assertRotationSequenceIntegrity` | — |
| One obligation's projection inconsistent with its own ledger (e.g. `FULFILLED` with no confirmed payment) | No — this is invisible to the pure lifecycle-state validator, which never looks at `ContributionObligation`/`ContributionPayment` at all | **Yes** — `assessContributionClosureReadiness`, re-run per round |
| Confirmed payout amount/currency drift | No — same reason | **Yes** — `assessPayoutClosureReadiness`, re-run per round |

This table is the concrete evidence for §5: **Option A (structural check
alone) cannot detect the financial-drift examples; only Option B
(structural check + financial revalidation, both reusing existing
extracted domain predicates) closes the gap this section asks about.**

## 27. Current owner UI after completion

Traced through `app/(app)/circles/[circleId]/page.tsx`'s actual,
current `loadWorkspaceOrSummary` logic: a `COMPLETED` circle reaches the
`DraftCircleOwnerReadNotDraftError` fallback branch (since it is not
`DRAFT`), which then calls `getActiveCircleSummaryForOwner` **first**,
inside a `Promise.all` alongside `getOwnerCircleContributions`,
`getOwnerCirclePayouts`, and `getOwnerRoundLifecycle`. Both
`getActiveCircleSummaryForOwner` and `getOwnerCircleContributions` are
`ACTIVE`-only and would throw (`ActiveCircleOwnerReadNotActiveError`/
`OwnerContributionsCircleNotActiveError`) for a `COMPLETED` circle; the
page's own `catch` block collapses **both** of those specific error
classes to `notFound()` (they are already explicitly listed there,
predating this ticket). **Result: the owner's own `/circles/[circleId]`
route 404s entirely for a circle they just completed**, even though
`getOwnerCirclePayouts` (already `COMPLETED`-eligible) would have real,
permanent data to show. This is the exact gap §14 already named — listed
here again because this ticket's own section 27 asks for it explicitly.
**Not fixed in this audit** (no code changes, per this ticket's
instruction) — flagged as required follow-up for whatever ticket
eventually builds the completion UI.

## 28. Member UI after completion

Traced through `app/member/circles/[circleId]/page.tsx`: it calls
`getCircleMemberDashboard` and `getCircleMemberPayouts` in parallel, both
already `COMPLETED`/`ARCHIVED`-eligible (§13). Its own `catch` only
redirects to `/member/login` for `NotFound`/`NotEligible`/`MemberNotFound`/
`MemberNotActive` errors — none of which a `COMPLETED` circle would ever
trigger for an existing `ACTIVE` member. **Confirmed: the member
dashboard, payout history, and round-status display all continue to
render normally and correctly, with zero code changes, for a `COMPLETED`
circle.** `member-payout-card.tsx`/`member-payout-controls.tsx` render
confirm/dispute controls only for a `RECORDED` payout — since completion
requires every payout already `CONFIRMED`, no inappropriate control could
ever render post-completion regardless. **No follow-up required on the
member side.**

## 29. Archive UI implication (informational only, not designed here)

If archive ships later (§16, Option B — deferred): the natural, precedent
-consistent shape (matching how `getOwnerCirclePayouts` already
distinguishes `ACTIVE`/`COMPLETED`/`ARCHIVED` as one eligible set) is
that a `COMPLETED` circle remains in whatever the owner's default circle
list becomes (no such list exists yet in this codebase today — owners
navigate to a specific circle by id, there is no "my circles" index page
in scope anywhere in this audit), and `ARCHIVED` would be the status that
removes it from that default view while `getOwnerCirclePayouts`-style
permanent reads remain unaffected. Member visibility should persist
identically through `ARCHIVED` too, exactly as it already does today for
the (currently unreachable) `ARCHIVED` value in every member-eligibility
list this audit found (§13). **Not designed further here** — informational
only, per this ticket's own instruction.

## 30. Product copy contract

**Frozen distinction** (extending, not duplicating, 7K.16's own already-
shipped copy):

- Round lifecycle (7K.16, already shipped): *"All rotation rounds are
  closed."* / *"The circle has not yet been marked complete in NIA."*
- Circle completion (future): *"The circle is complete."* — a short,
  declarative, past-tense-of-completion statement, never claiming
  anything about money movement.
- Archive (future, deferred): *"Archived."*

**Never**, in any of the above: "payment completed," "money
transferred," "funds distributed by NIA," or any phrasing implying NIA
itself moved, held, or executed a financial transaction — NIA records
external financial activity only, the same non-negotiable product truth
every prior SUSU ticket in this sequence has already enforced in its own
copy (`RecordPayoutForm`: *"NIA does not send, hold, or transfer
money"*; `PayoutDesk`: identical language).

## 31. Out-of-scope features (explicit)

Reopening a completed circle; reversing completion; payout correction;
dispute adjudication; replacing a disputed payout; removing/replacing an
already-activated member; changing contribution terms post-activation;
changing payout order post-activation; cancellation after activation;
owner transfer; admin override; partial completion; per-member
completion; automatic archive; automatic completion; a background
scheduler; external payment execution. None of these is implemented,
designed in detail, or implied as necessary by anything in this audit.

## 32. Security / authorization

**Frozen, identical to every other SUSU mutation**: a future
`completeCircle` Server Action must authenticate via `requireUser()` at
the action boundary only (deferred dynamic import, matching every
existing owner action's own established pattern), deriving a trusted
`ownerId` that is never read from `FormData`; the service itself must
independently re-verify fresh ownership under the circle lock (never
trusting the action-layer check alone, matching every existing SUSU
writer); no member-session authority
(`requireCircleMember`) is ever involved; no recipient/payout-actor
identity is ever inferred or accepted as input. `circleId` is the only
input the future action/service pair needs.

## 33. Documentation output

This document. Created as a dedicated file (not a further §21
subsection of `susu-payout-workflow-audit.md`) per this ticket's own
stated preference, since §21 has already grown to 31 subsections across
7K.11–7K.16.

## 34. Final audit-question answers

1. **What exact persisted facts authorize completion?**
   `SavingsCircle.status === "ACTIVE"`, structural round-sequence/
   provenance integrity, and every persisted `PayoutRound.status ===
   "CLOSED"` (§5/§6).
2. **Is every-round-`CLOSED` alone sufficient?** Logically, yes (7K.1
   item 10's reduction is confirmed true against the actual 7K.13
   implementation, §5) — but "logically sufficient" and "safe to trust
   without re-derivation" are different questions; see #3.
3. **Must financial ledgers be revalidated at completion?** **Yes —
   Option B, frozen** (§5/§26): re-run the existing, unmodified
   `assessContributionClosureReadiness`/`assessPayoutClosureReadiness`
   domain predicates for every round, as defense-in-depth against raw DB
   corruption a bare status check cannot see.
4. **Who may complete?** Owner only (§3), necessarily the circle's one
   immutable original owner (§18).
5. **Is completion explicit or automatic?** Explicit owner action, after
   all rounds close (Option B, §4) — never automatic, never time-driven.
6. **What replay semantics apply?** Natural, no `clientOperationId`;
   exact replay requires the SAME (only possible, per §18) owner and
   coherent persisted provenance; no timestamp/actor regeneration (§9).
7. **What happens to fresh contribution/payout writes after completion?**
   Already blocked today, unconditionally, by each service's own
   existing `status !== "ACTIVE"` gate — no new gate needed (§11/§12).
8. **What historical replays remain valid?** All of them — every exact-
   intent and terminal-decision replay already explicitly documented in
   7J.2/7J.3/7K.3/7K.4/7K.5 as surviving `COMPLETED`/`ARCHIVED` (§11/§12).
9. **Can members still read after completion?** Yes, already true today,
   zero code changes needed (§13).
10. **Can owners still read historical accounting after completion?**
    Payouts: yes, already true (`getOwnerCirclePayouts`). Contributions:
    **no, today** — a genuine, named follow-up gap (§14).
11. **Is archive required before Phase 7 freeze?** No — deferred, Option
    B (§16); schema is already ready for it whenever it ships.
12. **Does current schema need any migration?** **No** (§1) —
    `completedAt`/`completedById`/`archivedAt`/`archivedById` already
    exist with correct nullability, FK, and `onDelete: Restrict`
    behavior.
13. **What concurrency races must implementation prove?** The six named
    in §21, with the final-round race (§22) and double-completion race
    (§23) being the two requiring dedicated live concurrency tests,
    mirroring 7K.13's own six-race test suite exactly in spirit.
14. **Are there any P0/P1 blockers before implementation?** **No P0.**
    **One P1** (§14/§27): the owner's own `/circles/[circleId]` route
    currently 404s once a circle is `COMPLETED`, because
    `getActiveCircleSummaryForOwner`/`getOwnerCircleContributions` are
    `ACTIVE`-only — this must be scheduled as a companion or immediately
    -following ticket to whatever implements `completeCircle`, or an
    owner who completes their own circle loses access to their own
    permanent records through the UI (the underlying data itself remains
    safe and queryable; this is a UI/read-model wiring gap, not a data
    -loss risk).

## Verification

- `pnpm lint`: clean.
- `pnpm build`: succeeds.
- `pnpm prisma validate`: schema valid.
- `pnpm prisma migrate status`: database up to date, no pending
  migrations.
- `git diff --check`: clean.
- No application code, schema, service, repository, action, UI, or test
  was changed to produce this document — verified by `git status`
  showing only this new file (plus, if applicable, an unrelated-ticket
  index pointer in the sibling audit doc).

**TICKET 7L — SUSU CIRCLE COMPLETION AUDIT & V1 CONTRACT: READY FOR
IMPLEMENTATION**

One P1 follow-up is required as a companion/immediately-following ticket
(§14/§27/§34.14), but it blocks nothing in this audit's own scope and
does not block a future `completeCircle` service/action from being
implemented correctly — it blocks only the *UI* from correctly surfacing
the result. No P0 finding exists. No contradiction with 7K.11–7K.16 was
found; every "frozen" item above either confirms, extends, or exercises
an already-existing contract rather than reopening one.

## 35. 7L.1 implementation note

**Status: implemented and tested.** This section records what 7L.1
actually built against the frozen contract above — it does not reopen or
amend any "frozen" decision in §1–34; every choice below either directly
implements one of those decisions or was a genuinely new implementation
detail (query batching, error re-export shape) consistent with them.

**Files added** (no existing file was modified):
`src/repositories/circle-completion.repository.ts` (the one CAS write —
`completeActiveCircle`, guarded by `id`+`ownerId`+`status: "ACTIVE"` in
one `updateMany`, mirroring `completeActivePersonalGoal`'s own
ownerId+status CAS guard — plus read-only queries batched across the
whole circle: one query for every obligation, one for every obligation's
confirmed-payment ledger sum, one for every payout — never one
round-trip per round, per §5's own required query shape),
`src/services/circle-completion.service.ts` (the one public operation,
`completeCircle({ ownerId, circleId })`), and
`src/services/circle-completion.service.test.ts` (26 live-Postgres
fixture tests, 0 mocks).

**Reused, never reimplemented**: `assertRotationSequenceIntegrity` and
`assertRoundLifecycleStateIntegrity` (`src/domain/round-lifecycle.ts`),
wrapped in this service's own `CircleCompletionIntegrityError`, exactly
the same wrap-the-shared-validator idiom `circle.service.ts`'s
`assertActivatedRotationIntegrity` and `round-lifecycle.service.ts`'s
`assertLifecycleStateIntegrity` each already use (§6/§7) — a third
wrapper, not a fourth drifting copy. `assessContributionClosureReadiness`/
`assessPayoutClosureReadiness` (same file) are re-run, per round, for the
frozen §5 Option B defense-in-depth revalidation — any outcome other than
`READY` for an already-`CLOSED` round is reported as
`CircleCompletionIntegrityError`, never `CircleCompletionRoundsIncompleteError`
(§9/§20, verified by dedicated corruption tests below).
`computeExpectedPayoutAmount`/`PayoutAccountingIntegrityError`
(`src/domain/payout-accounting.ts`) are used/re-exported identically to
`round-lifecycle.service.ts`'s own existing pattern — imported without a
local binding and only re-exported, since (like that file) this service
never catches it directly.

**Locking**: the unmodified `lockSavingsCircleForUpdate`
(`circle-lock.repository.ts`), acquired inside `prisma.$transaction`,
same lock order as every other SUSU writer (§21) — verified by a
dedicated structural test asserting the import and at least one call
site, and that no `$queryRaw`/second lock mechanism exists in this
service.

**Shape**: mirrors `activateFirstRound`/`advanceRound` exactly — an
unlocked pre-check (not-found → authorization → terminal replay
short-circuit → cheap "every round CLOSED" structural check, all without
the lock) followed by a locked, re-verified-from-scratch transaction that
only then runs the expensive per-round financial revalidation and the
CAS write, with a re-read-and-resolve (never assume) path on a CAS miss.

**Replay**: same-owner-only, exactly as frozen (§9) — ownership is
checked before the `COMPLETED` branch is ever reached, so a non-owner
observing an already-`COMPLETED` circle is denied
(`CircleCompletionAuthorizationError`), never treated as replay (verified
by a dedicated test). A same-owner replay performs zero writes and never
regenerates `completedAt`/`completedById` (verified: `updatedAt` and
`completedAt` are byte-identical before/after the second call).

**Provenance/timestamp**: writes exactly `status`/`completedAt`/
`completedById` — a dedicated test asserts `activatedAt`/`activatedById`/
`archivedAt`/`archivedById` and every `PayoutRound`/
`ContributionObligation`/`ContributionPayment`/`Payout` row are
byte-identical before and after a successful completion. A separate test
asserts `completedAt` postdates the final round's own `closedAt` (never
derived from it), and a future-due-date fixture (`startDate` in 2099)
proves no date gates eligibility.

**Concurrency evidence, both real Postgres, no mocks**:
- Two concurrent `completeCircle` calls (same owner, same circle):
  exactly one resolves `replayed: false`, the other `replayed: true`,
  both report byte-identical `completedAt`/`completedById`, and the
  persisted row shows exactly one `COMPLETED` transition.
- `advanceRound` on the final round raced against `completeCircle`: the
  advance always succeeds regardless of order; the final round is
  `CLOSED` either way; completion either succeeds (advance won the lock
  first) or fails `CircleCompletionRoundsIncompleteError` while the
  circle remains `ACTIVE` (completion won the lock first) — never a
  partial or automatically-chained transition, matching §22 exactly.

**Corruption tests** (all live-DB, via a direct `prisma.*.update` call
that no service in this codebase could ever produce — each documented
inline in the test as such): a broken round-number sequence (gap, not a
duplicate — the unique index already makes duplicates impossible); a
`CLOSED` round missing `closedById`; a `CLOSED` round's confirmed-payment
ledger silently disagreeing with its `FULFILLED` obligation status; a
`CLOSED` round's `CONFIRMED` payout amount drifted from the frozen
expected total. All four are rejected as `CircleCompletionIntegrityError`
and leave the circle `ACTIVE` (§26, all four rows of that table's
corruption examples now have live-DB test coverage, not just analysis).

**Post-completion financial behavior**: one test proves exact-intent
`recordContribution`/`recordPayout` replay (same `clientOperationId`)
and terminal-decision `confirmContribution`/`confirmPayout` replay both
remain valid after completion, unmodified; a second test proves a
genuinely fresh `recordContribution`/`recordPayout` call (a new
`clientOperationId`) is rejected — as `ContributionRecordingCircleNotActiveError`/
`PayoutRecordingCircleNotActiveError` respectively — because the circle
is no longer `ACTIVE`, with no new completion-specific gate added to
either service (§11/§12/§19, confirmed rather than merely asserted).

**No UI, no Server Action**: neither exists for this ticket, by design
(§22) — `completeCircle` cannot yet be triggered through the product.
The P1 owner-route gap (§14/§21/§27: `/circles/[circleId]` 404s once a
circle is `COMPLETED`, because `getActiveCircleSummaryForOwner`/
`getOwnerCircleContributions` remain `ACTIVE`-only) is unchanged and
remains outstanding, exactly as this audit already flagged — it is a
follow-up for the ticket that adds the Server Action/UI, not something
7L.1 could or should fix.

**Test methodology, stated precisely**: all 26 new tests are live
PostgreSQL integration tests (real `activateCircle`/`activateFirstRound`/
`advanceRound`/`recordContribution`/`confirmContribution`/`recordPayout`/
`confirmPayout` service calls to build fixtures; no mocks, no stubs);
three are structural/source-regex tests (asserting import/call-site
text, not runtime behavior) clearly labeled as such; two are genuine
concurrency tests using `Promise.allSettled` against the real shared row
lock (no synthetic delay or mocked race). No test was skipped or hidden;
the full suite ran to its final summary.

**Verification**: `pnpm lint` clean; `pnpm build` succeeds; `pnpm prisma
validate` schema valid; `pnpm prisma migrate status` up to date, no
pending migrations (none expected, none made); `git diff --check`
clean; `npx tsc --noEmit` shows the same 9 known pre-existing errors,
unchanged, all in unrelated test files. `pnpm test` (full suite, 1301
tests): 1298 passed, 7 skipped (pre-existing, require an unset
`TEST_DATABASE_URL`), 1 failed on the first full run —
`circle-member-auth-rate-limit.service.test.ts`'s own TARGET-scope test,
in a file this ticket never touched. Re-run in isolation, it failed
once more and then passed cleanly on the next run moments later; its own
GLOBAL bucket is a real, shared, non-isolated 60-second-window row in
the dev database (the file's own comments document this), and this
session had just run the full suite repeatedly — consistent with
transient cross-run GLOBAL-window exhaustion, not a regression from
this ticket. Reported precisely rather than called either "clean" or
"failed" without qualification, per this ticket's own instruction.

**Boundary audit** (§27): `git status` shows exactly three new,
untracked files and zero modified files. Grepped the new files and
confirmed no Server Action (`"use server"`), no UI component, no
archive writer, no reference to `completeCircle`/`COMPLETED`/
`archivedAt`/`archivedById` inside `round-lifecycle.service.ts` (which
this ticket never edited), and no notification/scheduler/admin/payment-
execution code anywhere in the two new source files.

**TICKET 7L.1 — SUSU CIRCLE COMPLETION SERVICE: COMPLETE**
