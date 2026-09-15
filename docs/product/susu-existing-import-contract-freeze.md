# SUSU Existing-Circle Import — V1 Contract Freeze (9B.1)

Status: **BINDING ARCHITECTURE CONTRACT. No implementation was performed by
this ticket.** This document turns the evidence in
`docs/product/susu-existing-import-domain-audit.md` (9B) and the signed
product decisions for 9B.1 into the authoritative amendment to the Phase 7
SUSU freeze. The audit remains the reasoning record; this document resolves
its open decisions.

## 1. Governing historical-truth rule

> **NIA may record an owner's declaration about pre-NIA history, but must
> never represent that declaration as though NIA observed, recorded, or
> verified the underlying financial event.**

This rule overrides convenience in persistence, lifecycle predicates, read
models, and copy. A provenance value of `IMPORTED_DECLARATION` means only:

- the owner declared the stated historical outcome when NIA imported the
  circle; and
- NIA recorded that declaration at the import timestamp.

It never means that NIA saw a contribution, recorded a pre-NIA payment,
confirmed a recipient's receipt, or knows the real-world event time. Normal
NIA-managed `ContributionPayment` and recipient `Payout` confirmation/dispute
workflows remain the only sources for NIA-managed financial history.

## 2. V1 import boundary and eligibility

An import represents a single contiguous, fully completed prefix of the
rotation:

```
rounds 1..K       owner-declared imported history, CLOSED
round K + 1..N    NIA-managed lifecycle, initially UPCOMING
```

`K` is `historicalCompletedRoundCount`. It is declared by the owner in DRAFT;
it is never derived from elapsed time, due dates, or existing financial rows.
Only **fully completed** historical rounds may be imported. A partially
completed real-world round is never reconstructed as historical state. Any
already-made contribution for the first live round is recorded by the ordinary
live/manual contribution workflow after activation, with its normal NIA
recording timestamp and provenance.

V1 accepts an import only when all historical completed rounds used the same
currency and contribution amount as the imported circle terms. The owner must
not use current terms to overwrite known historical amount/currency drift.
Instead, validation rejects the import with a safe explanation: historical
term changes are unsupported in V1 and require a future amendment workflow.

### Zero and completed-circle edges

| Case | Binding behavior | Reason |
| --- | --- | --- |
| `K = 0` | Not an import. Persist and activate it as an ordinary `NEW` circle; the normal future-or-today start-date rule applies. | There is no historical lifecycle state to reconstruct, so an imported origin or past date must not become a bypass for ordinary creation. |
| `1 <= K < N` | Valid ongoing-circle import. | NIA takes over at the first non-imported round. |
| `K = N` | Reject in V1. | There is no live round for NIA to manage. NIA must not force an already-finished imported circle into `ACTIVE`, and the normal explicit-completion contract cannot truthfully be replayed from an external declaration. A future read-only historical-import product may address this separately. |

Therefore `IMPORTED` is only valid for an ongoing circle and requires
`1 <= historicalCompletedRoundCount < active-member count` at activation.

## 3. Ownership, correction, and immutability

Only the authenticated platform `User` who owns the circle may configure and
activate import history. Circle members neither confirm imported contributions
nor confirm/dispute imported payouts.

Until the single activation transaction commits, ordinary DRAFT edits may
correct original start date, terms, membership, payout order, and `K`.
Activation freezes them under the existing DRAFT-to-ACTIVE rules. Afterwards,
the import declaration and its reconstructed rows are immutable in V1:

- no destructive correction, reopening, recipient rewrite, or historical
  count change;
- no imported payout recipient confirmation/dispute controls;
- no inferred correction based on dates or later financial events.

A discovered post-activation error is an out-of-band administrative matter;
V1 adds no self-service correction ledger or deletion path.

**Implemented foundation (9D.0).** Normal (`NEW`) DRAFT circle terms are
owner-editable through one lock-scoped configuration operation. It shares the
normal creation validation and is serialized with activation on the same
circle row; activation freezes the resulting configuration. Imported origin/K
editing remains a later import-configuration responsibility, but will use
this same pre-activation correction window. No post-activation correction is
introduced.

## 4. Minimum additive persistence contract

The following names are the binding conceptual schema contract. Exact Prisma
relation names and migration SQL may follow repository conventions, but their
semantics may not be weakened.

### Enums

| Enum | Values | Why / source of truth |
| --- | --- | --- |
| `CircleOriginKind` | `NEW`, `IMPORTED` | Identifies whether a circle has an owner-declared pre-NIA prefix. The circle row is authoritative. |
| `RoundClosureBasis` | `NIA_MANAGED`, `IMPORTED_DECLARATION` | States why a `CLOSED` round is considered closed. A round row is authoritative. |
| `ContributionFulfillmentBasis` | `NIA_CONFIRMED_LEDGER`, `IMPORTED_DECLARATION` | States whether `FULFILLED` comes from the normal confirmed-payment ledger or the owner's import declaration. The obligation row is authoritative. |
| `PayoutConfirmationBasis` | `MEMBER_CONFIRMED`, `IMPORTED_DECLARATION` | States whether a confirmed payout was confirmed by the normal recipient workflow or declared on import. The payout row is authoritative. |

### Fields and constraints

| Location | Additive field / constraint | Default and existing-circle compatibility | Immutable / future writer |
| --- | --- | --- | --- |
| `SavingsCircle` | `originKind CircleOriginKind @default(NEW)` | Existing circles receive `NEW`; their behavior is unchanged. | Frozen once created. Draft-creation/import configuration only. |
| `SavingsCircle` | `historicalCompletedRoundCount Int @default(0)` | Existing circles receive `0`. A `NEW` circle must retain `0`; an `IMPORTED` circle must validate `1 <= K < N` at activation. A database CHECK may enforce non-negative values, but the cohort upper bound is service-authoritative. | Frozen at activation. Draft configuration only. |
| `SavingsCircle` | `importedAt DateTime?`, `importedById String?` with restrictive FK to `User` | Null for existing and `NEW` circles. Both become non-null together only for a successfully activated imported circle. | Set once by import activation. They timestamp/identify NIA receiving the declaration, not the historical events. |
| `PayoutRound` | `closureBasis RoundClosureBasis @default(NIA_MANAGED)` | Existing/native rounds remain NIA-managed. | Set at creation/reconstruction; never changed. |
| `ContributionObligation` | `fulfillmentBasis ContributionFulfillmentBasis @default(NIA_CONFIRMED_LEDGER)` | Existing/native obligations remain ledger-backed. | Set only by activation reconstruction or normal confirmation writer, never rewritten. |
| `Payout` | `confirmationBasis PayoutConfirmationBasis @default(MEMBER_CONFIRMED)` | Existing payouts remain member-confirmed under current semantics. | Set on insert; terminal and immutable. |

No new historical transaction model, amount field, member identity, generic
import record, unique constraint, or index is required. Existing structural
constraints remain the authority: exactly one round per `(circle, number)`,
one recipient per circle, one obligation per `(round, member)`, and one payout
per round. Existing round/obligation indexes remain sufficient because basis
is read with the same circle/round/status predicates.

The additive migration must include restrictive foreign-key behavior for
`importedById`; it must not backfill, fabricate, or alter existing financial
rows. Defaults make existing circles `NEW`/NIA-managed automatically.

### Required interpretation of existing fields

An imported reconstructed `Payout` must retain the existing structural shape
needed by current round/read models (`status = CONFIRMED`, exact frozen amount
and currency, one row per round), but **its `confirmationBasis` is
`IMPORTED_DECLARATION`**. In that basis:

- `confirmedByMemberId` is null; no member action is invented.
- `confirmedAt` is the time NIA captured the declaration, never a claimed
  recipient-confirmation or real-world payout time.
- the required existing `recordedById`/`recordedAt` describe the owner's
  import declaration being recorded by NIA, not the underlying payout.
- UI, authorization, audit export, and readiness logic must branch on basis;
  they must not display normal “recipient confirmed” language or expose
  Confirm/Dispute controls.

Likewise, an imported `FULFILLED` obligation has no `ContributionPayment`
rows. Its `fulfilledAt` is NIA's declaration-capture time, not an asserted
payment time. A normal NIA-ledger obligation must continue to derive its
fulfillment from confirmed `ContributionPayment` rows exactly as Phase 7
already requires.

## 5. Transactional activation and reconstruction algorithm

Future implementation uses the shared circle-row lock and one transaction.
It must reuse the same rotation/obligation generator as normal activation;
there is no parallel generator.

1. Resolve the circle sufficiently to identify it, then begin a transaction.
2. `SELECT ... FOR UPDATE` the `SavingsCircle` row first.
3. Re-read the authoritative circle, owner, DRAFT status, origin, terms,
   start date, members, and payout order under the lock. Verify the trusted
   owner identity.
4. Validate the normal DRAFT cohort/order requirements and `N` active members.
5. If `originKind = NEW`, require `K = 0` and run the established normal
   activation path unchanged.
6. If `originKind = IMPORTED`, require `1 <= K < N`, a true original
   start date, and the declared same-term guarantee. Reject known amount or
   currency drift rather than projecting current terms backward.
7. Generate exactly `N` `PayoutRound` rows and exactly `N × N`
   `ContributionObligation` rows from the immutable DRAFT cohort, payout
   order, terms, and `roundDueDate(originalStartDate, roundNumber)`.
8. For each round `1..K`, in the same transaction:
   - set it `CLOSED` with `closureBasis = IMPORTED_DECLARATION`;
   - set all of its obligations `FULFILLED` with
     `fulfillmentBasis = IMPORTED_DECLARATION`;
   - insert its one `Payout` at the frozen expected total with
     `status = CONFIRMED` and
     `confirmationBasis = IMPORTED_DECLARATION`;
   - use the import declaration actor/time only as described in §4; do not
     create `ContributionPayment` rows or a recipient confirmation.
9. Leave rounds `K+1..N` `UPCOMING` with NIA-managed basis, obligations
   `OPEN`/ledger basis, and no payout.
10. Set `importedAt`/`importedById` once, transition the circle to `ACTIVE`
    using the existing activation provenance, and commit.

All scheduled dates are reconstructed from the original start date using the
existing rules: weekly `+7`, biweekly `+14`, and monthly original-day with
month-end clamping. A due date is schedule information only; time passing
never closes a round, fulfills an obligation, records a payout, or changes K.

If any validation, structural assertion, conditional write, or provenance
check fails, the entire transaction rolls back. The transaction may not commit
an `ACTIVE` circle with un-reconstructed historical rounds.

Replay is natural-state replay. A retry after successful import re-locks and
re-reads the circle, verifies the exact immutable NIA-managed/imported shape,
and returns the original result without fresh timestamps or writes. A mismatch
is an integrity error, never an excuse to restamp or repair history.

## 6. First live round and normal lifecycle extension

`activateFirstRound` must be generalized only at its explicit-start
precondition:

- for `NEW`, target round is exactly 1 and all rounds remain `UPCOMING`;
- for `IMPORTED`, target round is authoritatively derived as `K + 1`, not
  accepted from the client; every lower round must be `CLOSED` with imported
  basis, the target `UPCOMING`, and every later round `UPCOMING`.

It locks, re-reads, verifies the exact shape, and CAS-activates that target.
At most one round may be `ACTIVE`; no historical round can be reopened or
skipped. Replay resolves only the derived target's legitimate `ACTIVE` or
`CLOSED` state. `advanceRound`, terminal behavior, strict progression, and
the final-round distinction from explicit circle completion remain unchanged.

## 7. Readiness, payout integrity, and completion

Normal NIA-managed logic stays unchanged:

- contribution readiness is derived from exact confirmed ledger payments;
- payout readiness requires the normal recorded/recipient-confirmed payout
  rules and treats disputes as blocking;
- the normal actor/timestamp fields retain their current meanings.

For a round with `closureBasis = IMPORTED_DECLARATION`, readiness is satisfied
only when its persisted historical shape is internally coherent:

1. every same-circle obligation is `FULFILLED` with
   `fulfillmentBasis = IMPORTED_DECLARATION` and no payment ledger rows;
2. exactly one same-circle payout exists, has the frozen exact expected total
   and currency, is `CONFIRMED` with
   `confirmationBasis = IMPORTED_DECLARATION`, and has no member confirmer or
   disputer;
3. round status and import declaration provenance are coherent.

Any mixed or contradictory basis/ledger shape is an integrity error, not a
fallback to “complete.” This is what lets imported rounds satisfy structural
closure without pretending NIA obtained individual confirmations.

Circle completion remains an explicit owner operation. It succeeds only when
every scheduled round is `CLOSED` exactly once and each passes the basis-aware
readiness predicate above. Imported closure plus NIA-managed closure is
therefore complete evidence of the lifecycle, while the source of each fact
remains visible and truthful. Completion never relies on elapsed dates.

## 8. Read-model, privacy, and language contract

Imported rounds must visibly differ from NIA-managed rounds for both owner and
member readers:

- EN: **Imported history** — *Reported when this circle was imported into
  NIA.*
- FR: **Historique importé** — *Déclaré lors de l'importation de ce cercle
  dans NIA.*

Owner views may show the imported boundary, K, and the declaration actor/time
because that is owner configuration/history. Member views may see that a round
is imported, its scheduled recipient, and whether their historical obligation
was declared fulfilled, but not owner-only import-configuration mechanics or
unrelated private data. Neither view may say “NIA confirmed,” “recipient
confirmed,” or “NIA witnessed” for imported facts. Imported payout rows never
render Confirm/Dispute controls.

Circle ID + Member Code + PIN remains the only membership-authentication
contract. Phone remains contact-only. Import grants no additional member
authority and does not expose owner Auth.js identity or credentials.

## 9. Phase 7 invariant amendment table

| Phase 7 invariant | Import extension | Status | Authoritative source | Required future test |
| --- | --- | --- | --- | --- |
| DRAFT → ACTIVE → COMPLETED | Imported circles use the same states; only ongoing `1 <= K < N` imports may activate. | Amended | Circle row + locked activation | K bounds; full-import rejection; no partial commit |
| N members → N rounds → N² obligations | Generate the entire structure once, including historical rounds. | Unchanged | Shared generator + DB uniqueness | Counts for imported and native circles |
| Payout order/recipient frozen at activation | Imported recipient is derived only from DRAFT payout order. | Unchanged | CircleMember/PayoutRound constraints | Historical recipient/order is frozen |
| Exact amount/currency | Same terms across all imported rounds required; known drift rejects. | Amended | Validated import declaration + frozen obligations | amount/currency drift rejection |
| Financial truth | Normal ledger/member confirmation remains authoritative; imported declaration has explicit basis. | Amended | Basis fields + row shape | no fabricated payments/member confirmations |
| One payout per round | Imported history occupies the same one immutable payout slot with imported basis. | Unchanged | `Payout` unique round constraint | exactly one imported payout per historical round |
| Contribution/payout readiness | Imported basis uses coherent declaration shape; managed basis uses frozen normal predicates. | Amended | Basis-aware domain predicates | mixed-basis corruption rejected |
| Explicit first-round start | Target is 1 for NEW, K+1 for IMPORTED. | Amended | Locked circle origin/K + rounds | imported first-live activation and replay |
| Strict progression / ≤1 ACTIVE | Imported CLOSED prefix precedes one explicit live start; no reopening/skipping. | Amended | Existing lifecycle validator + amended start service | concurrent starts/advances |
| Due-date discipline | Original schedule reconstructs dates; dates never infer events. | Unchanged | `roundDueDate` | old weekly/biweekly/monthly schedules |
| Completion explicit and separate | All rounds, imported plus managed, must pass truthful basis-aware closure. | Amended | Completion service | final close is not completion; explicit completion succeeds |
| Owner authority | Owner alone declares import; members do not confirm imported history. | Unchanged | trusted owner + circle lock | non-owner/member denied |
| Replay and locking | Import activation is one locked transaction and natural-state replay. | Amended | circle row lock + CAS/re-read | duplicate/concurrent activation |
| Existing-circle behavior | Defaults retain native semantics with no data fabrication. | Unchanged | additive defaults | all pre-import fixtures unchanged |

## 10. Implementation decomposition

1. **9C — Import provenance persistence foundation:** additive enums/fields,
   restrictive FK, defaults, and migration audit only.
2. **9D — Import DRAFT validation and configuration:** origin/K schema and
   service validation, past-date rule only for a genuine import, no activation.
3. **9E — Import activation and rotation reconstruction:** one locked,
   replay-safe generator/reconstruction transaction and its database tests.
4. **9F — Basis-aware readiness and first-live-round lifecycle:** pure
   readiness predicates plus the minimal derived-target `activateFirstRound`
   extension; preserve normal behavior with focused concurrency tests.
5. **9G — Imported-history read models and presentation:** owner/member
   labeling, privacy boundary, and suppression of imported payout actions.
6. **9H — Import end-to-end adversarial verification and freeze:** live
   lifecycle/concurrency evidence, data-safety review, and final contract
   audit.

## 11. Resolved questions

- Historical amount and currency drift: **unsupported and rejected in V1**.
- Post-activation historical correction: **no self-service rewrite in V1**.
- Imported payout confirmation/dispute: **not available**; a declaration is
  neither a recipient confirmation nor a disputable NIA payout workflow.
- Zero completed rounds: **normal new-circle path only**.
- All rounds completed: **rejected in V1**, pending a separately designed
  read-only historical import product.

No remaining domain decision blocks implementation. The next ticket must begin
with the persistence foundation; it must not combine migration, import
activation, lifecycle, or UI work.

## 12. 9E implementation note (clarification only, no product-policy change)

9E implemented `activateImportedCircle` (`src/services/circle.service.ts`)
exactly against §5 above. This section records implementation-level facts
this freeze's own text left slightly underspecified, per this ticket's own
instruction to clarify rather than amend policy.

**Imported activation is the commit point.** Nothing before a successful
`activateImportedCircle` transaction persists any historical round,
obligation, or payout row — a DRAFT circle that never activates leaves
zero trace of the owner's declared history beyond the DRAFT
`historicalCompletedRoundCount`/`originKind`/`startDate` fields §5–§9D.1
already covered. The transaction is all-or-nothing (Prisma `$transaction`,
the shared `SavingsCircle` row lock held throughout): there is no
persisted state between "DRAFT, nothing reconstructed" and "ACTIVE, the
complete N-round/N² structure with rounds 1..K fully historical."

**`importedAt`/`importedById` semantics, precisely.** Both are set once,
together, in the same write as `activatedAt`/`activatedById`, using one
shared `new Date()` captured at the start of the transaction's write
phase. This is a deliberate implementation choice: unlike round-closure
vs. circle-completion (§8's own precedent — two independent owner actions
that can coincidentally land in the same second), "NIA activated this
circle" and "NIA recorded the owner's import declaration" are not two
separable real-world events for an imported circle — they are two facets
of the single atomic transaction that both facts describe. `importedAt`
never means, and is never treated as meaning, when any historical
contribution or payout actually happened — only when NIA captured the
owner's declaration about the whole historical prefix.

**Every other historical timestamp uses the same shared value**, for the
identical reason: each historical round's `activatedAt`/`closedAt`, each
historical obligation's `fulfilledAt`, and each historical payout's
`recordedAt`/`confirmedAt` are all the one import-declaration instant —
never a fabricated, per-event historical date. `PayoutRound.dueDate`
(computed from the true, possibly-past, owner-declared `startDate` via
the unmodified `roundDueDate`) remains the only field that carries the
real historical schedule.

**Zero ACTIVE rounds immediately after imported activation.** Rounds
1..K commit `CLOSED`/`IMPORTED_DECLARATION`; rounds K+1..N commit
`UPCOMING`/`NIA_MANAGED`. No round is ever `ACTIVE` when this transaction
returns. This required one structural domain amendment beyond §5's own
text: `assertRoundLifecycleStateIntegrity`
(`src/domain/round-lifecycle.ts`) previously rejected a CLOSED-prefix +
UPCOMING-suffix shape with zero `ACTIVE` rounds as corruption, because
that shape was genuinely unreachable before imported activation existed
(normal round progression always activates a non-final round's successor
in the same atomic step that closes it). The fix widens the shape this
one structural validator accepts — proven safe by the function's own
existing phase-order loop, not by loosening any provenance or sequence
check — and is exercised by both `activateImportedCircle`'s own
self-verification and by `completeCircle`
(`src/services/circle-completion.service.ts`), which would otherwise
mis-report a freshly-imported circle as corrupted rather than correctly
"rounds incomplete."

**K+1 activation belongs to the next lifecycle extension**, exactly as
this ticket's own instruction states. `activateImportedCircle` never
calls `activateLifecycleRound`/`closeLifecycleRound`/`activateFirstRound`
and never derives K+1 as a target. `round-lifecycle.service.ts` is
untouched by 9E. The one adjacent read-model fix this ticket made —
`getOwnerRoundLifecycle`
(`src/services/round-lifecycle-owner-read.service.ts`) previously assumed
"not all-UPCOMING and not all-CLOSED" implied exactly one `ACTIVE` round,
which is no longer true — reports the new shape honestly (a new
`IMPORTED_PREFIX_AWAITING_FIRST_ROUND` phase, `canStartFirstRound: false`)
rather than throwing an integrity error, but assigns it no eligibility or
transition logic; deriving what an owner may actually do next (starting
round K+1) is the next lifecycle ticket's own scope, consistent with §10's
own "9F — Basis-aware readiness and first-live-round lifecycle" boundary.

## 13. 9H final implementation freeze

9H performed the end-to-end adversarial audit §10 named as the last
decomposition step, against the actual implementation rather than prior
closeout reports. It found and fixed three real defects (two P0, one P1;
full detail in the 9H closeout report) before reaching this freeze. No
schema/migration change was required or made.

**Supported V1 import contract (re-confirmed against code, not assumed).**
Exactly as §2 states: an import is a single contiguous, fully-completed
prefix `1..K`, owner-declared at DRAFT time, immutable once activated; the
live suffix `K+1..N` is NIA-managed from first principles. `K = 0` is
never an import (routes to the ordinary `NEW` path); `K >= N` is rejected
at activation. Verified: no supported writer can produce `NEW` with `K >
0`, `NEW` with import provenance, or `IMPORTED` with `K = 0` — the DRAFT
validation schemas (`createImportedDraftCircleSchema`,
`updateImportedDraftCircleConfigurationSchema`) reject `K = 0` before a
row is ever written, `createDraftCircleRecord` hardcodes `K = 0` for every
`NEW` circle, and only `activateImportedCircle` ever writes
`importedAt`/`importedById`, gated on `circle.originKind === "IMPORTED"`.

**Authoritative K semantics.** `historicalCompletedRoundCount` is read
from exactly one place, the `SavingsCircle` row, at every point it is
used (DRAFT validation, activation bounds-check, `firstLiveRoundNumber`,
read-model presentation) — never inferred from elapsed time, a count of
`CLOSED` rounds, or the lowest `UPCOMING` round. `firstLiveRoundNumber`
(`src/domain/round-lifecycle.ts`) is the single shared derivation both the
write path (`activateFirstRound`) and the read path
(`getOwnerRoundLifecycle`) call, so they cannot diverge. A malformed
persisted K (negative, `K = 0` on an `IMPORTED` row, `K >= N`, or any
round-shape mismatch with the derived target) is rejected as an integrity
error by `assertFreshStartPrecondition`/`assertImportedPrefixCoherent`
rather than silently coerced into a plausible target.

**Historical provenance semantics.** `closureBasis`/`fulfillmentBasis`/
`confirmationBasis` are the sole presentation and readiness authority
everywhere they are read — never `roundNumber <= K`, never bare `status`.
`IMPORTED_DECLARATION` never means NIA observed, recorded, or verified the
underlying financial event (§1) — re-confirmed true at every read surface
audited in 9G and at the write surfaces 9H specifically re-examined
(contribution recording, payout confirm/dispute, circle completion).

**Activation reconstruction.** `activateImportedCircle`
(`src/services/circle.service.ts`) is the sole writer of the historical
prefix, reuses the same generator `activateCircle` uses, and is one
all-or-nothing transaction under the shared `SavingsCircle` row lock — see
§12 above for the precise timestamp/atomicity facts, re-verified
structurally (not re-derived) by 9H.

**First live round = K+1.** `activateFirstRound`'s target is
authoritatively `firstLiveRoundNumber(originKind, K)` — never client
input, never the lowest `UPCOMING` round. Replay resolves only that
derived target's own state; it can never drift to K+2 or any other round.

**Normal lifecycle resumption.** Once K+1 is `ACTIVE`, ordinary Phase 7
contribution/payout/round-lifecycle behavior applies unchanged to the live
suffix — re-confirmed unmodified in `contribution-recording.service.ts`
(NIA-managed branch), `payout-recording/confirmation/dispute.service.ts`,
and `advanceRound`. Historical-round provenance cannot contaminate it: a
CLOSED historical round short-circuits every writer's own replay/terminal
path before any live-round rule is reached.

**Presentation truthfulness.** Re-confirmed per 9G, extended by 9H's own
audit of `circle-workspace-overview.tsx` (the owner "Upcoming rounds"
preview, missed by 9G, could show an imported CLOSED round mislabeled
"Closed" — fixed) and the pre-existing (unrelated) stale-test drift named
in §25 of the 9H ticket, resolved rather than carried across this freeze.

**Unsupported cases (unchanged from §2/§11).** Historical amount/currency
drift; post-activation historical correction; imported payout
confirmation/dispute; `K = 0` as an import; `K = N` (a fully-completed
import). None of these has a writer path in this codebase.

**Defects found and fixed by 9H (see the 9H closeout report for full
detail):**

1. **P0 — `completeCircle` could never succeed for any circle with an
   imported prefix.** `circle-completion.service.ts`'s defense-in-depth
   financial revalidation ran every round, imported and NIA-managed alike,
   through the NIA-managed-only payout predicate
   (`assessPayoutClosureReadiness`, which requires
   `confirmedByMemberId === recipientId`). An imported payout's
   `confirmedByMemberId` is null by design (§4), so this always threw.
   Fixed with a new, dedicated, basis-aware predicate
   (`assertImportedRoundClosureCoherence`,
   `src/domain/round-lifecycle.ts`), applied only when
   `round.closureBasis === "IMPORTED_DECLARATION"`; the NIA-managed path is
   byte-unchanged.
2. **P0 — `recordContribution` could create a live `ContributionPayment`
   against an already-CLOSED imported historical round.** The existing
   "already fulfilled" guard is entirely ledger-based
   (`findActiveOrConfirmedPaymentForObligation`); an imported obligation
   has zero `ContributionPayment` rows by design, so the guard never saw
   it. Fixed with an explicit `fulfillmentBasis === "IMPORTED_DECLARATION"`
   rejection (`ContributionObligationImportedError`) before any
   ledger-based check, directly enforcing §8's "no writer may
   create/confirm/reject a contribution against an imported CLOSED
   historical round."
3. **P1 — pre-existing, unrelated UI-test drift carried an unexplained red
   suite across what should have been prior freeze boundaries.** Resolved
   per the 9H closeout report §23; none exposed a product defect.

## 14. Live database verification debt

The 9A (`CircleMember.phone`) and 9C (import-provenance) migrations remain
**unapplied** on the only reachable database in this environment. Every
fact in §13 above is **CODE/STRUCTURAL** evidence — full TypeScript
compilation, `prisma validate`/`generate`, lint, production build, and
every DB-independent unit/structural test, all green — never live
PostgreSQL transaction, concurrency, or constraint execution. Required
before production release: apply both migrations to a reachable database,
then re-run (at minimum) `circle-imported-activation.test.ts`,
`round-lifecycle-first-live-round.test.ts`,
`circle-completion.service.test.ts` for an imported circle,
`contribution-recording.service.test.ts` for the new imported-guard path,
and the full existing-circle-import lifecycle end-to-end against real
concurrent load, exactly as 7J/7K/7L's own live-DB evidence was gathered
for native circles.

## READY FOR IMPLEMENTATION
