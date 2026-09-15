# SUSU Existing-Circle Import — Adversarial Domain Audit (9B)

Status: **AUDIT ONLY.** No application code, schema, migration, or test was
changed to produce this document. It traces the actual, current frozen
Phase 7 SUSU architecture against the "import a SUSU already in progress"
problem, names every place a past `startDate` is rejected today, and
recommends one V1 architecture for a future implementation ticket to build
against — exactly the audit-then-freeze methodology already used by
`susu-contribution-workflow-audit.md` (7J), `susu-payout-workflow-audit.md`
(7K), and `susu-circle-completion-audit.md` (7L).

Every claim below is sourced from direct reads of `prisma/schema.prisma`,
`src/validations/circle.schema.ts`, `src/services/circle.service.ts`,
`src/domain/circle-rotation-schedule.ts`, `src/domain/round-lifecycle.ts`,
`src/services/round-lifecycle.service.ts`, `src/services/circle-completion
.service.ts`, `app/(app)/circles/new/new-circle-form.tsx`, and every prior
Phase 7 freeze document — not reconstructed from ticket descriptions.

---

## 1. Actual current architecture traced

**Models** (`prisma/schema.prisma`):

- `SavingsCircle` (208–239): `startDate`, `contributionAmount`, `currency`,
  `frequency` frozen at creation; `status: DRAFT → ACTIVE → COMPLETED`
  (`CANCELLED`/`ARCHIVED` exist in the enum, `CANCELLED` has zero writers
  anywhere — confirmed dead code, per 7L §2/§17). `ownerId` immutable —
  written once, never updated (7L §18).
- `CircleMember` (241–282): `memberCode`/`pinHash` created at
  `addDraftCircleMember` (DRAFT only); `payoutOrder` set only in DRAFT via
  `setDraftCirclePayoutOrder`; both frozen the instant the circle leaves
  DRAFT (`removeDraftCircleMember`/`setDraftCirclePayoutOrder` both call
  `assertDraftOwner`, which rejects any non-`DRAFT` circle).
- `PayoutRound` (321–350): one row per member, created **only** by
  `activateCircle`, `roundNumber` 1..N, `recipientId` frozen,
  `dueDate = roundDueDate(circle, roundNumber)` frozen at creation.
  `status: UPCOMING → ACTIVE → CLOSED`, both `activatedById` and
  `closedById` exist (contra the stale "no closedById column" note in an
  earlier draft of the 7K audit — the schema already carries full
  activation/closure actor provenance for both transitions).
- `ContributionObligation` (352–375): exactly one row per `(round, member)`
  pair, i.e. exactly N² per circle, created **only** by `activateCircle`,
  never afterward. `expectedAmount`/`currency`/`dueDate` frozen at creation.
  `status: OPEN → FULFILLED` — a **lifecycle projection only**, never the
  source of financial truth (frozen 7J).
- `ContributionPayment` (377–405): `RECORDED → CONFIRMED | REJECTED`, both
  terminal; a partial unique index (`WHERE status IN ('RECORDED',
  'CONFIRMED')`) permits unlimited `REJECTED` history but at most one
  live/confirmed payment per obligation, ever.
- `Payout` (407–436): `RECORDED → CONFIRMED | DISPUTED`, both terminal; a
  **full** (non-partial) `@@unique([roundId])` — one payout row per round
  for the *entire lifetime of that round*, no matter its outcome. A
  `DISPUTED` payout permanently occupies the slot; no second attempt is
  ever possible (frozen 7K.1 item 2, Option A).

**Canonical services, traced directly (not from docs):**

| Concern | Service | Key functions |
|---|---|---|
| Circle/member/order (DRAFT) | `circle.service.ts` | `createDraftCircle`, `addDraftCircleMember`, `removeDraftCircleMember`, `setDraftCirclePayoutOrder` |
| Activation | `circle.service.ts` | `activateCircle` — the **only** writer of `PayoutRound`/`ContributionObligation`, ever |
| Contribution recording/confirm/reject | `contribution-recording.service.ts`, `contribution-confirmation.service.ts`, `contribution-rejection.service.ts` | owner-only, circle-`ACTIVE`-only for fresh writes, round-status- and due-date-agnostic |
| Payout recording/confirm/dispute | `payout-recording.service.ts`, `payout-confirmation.service.ts`, `payout-dispute.service.ts` | owner records, recipient (member session) confirms/disputes; also round-status- and due-date-agnostic |
| Round lifecycle | `round-lifecycle.service.ts` | exactly two public ops: `activateFirstRound` (**hardcoded to `roundNumber === 1`**, line 334) and `advanceRound`; never `closeRound`/`activateNextRound` as independent ops |
| Circle completion | `circle-completion.service.ts` | implements the 7L-frozen contract exactly (error classes `CircleCompletionNotFoundError`/`…AuthorizationError`/`…NotActiveError`/`…RoundsIncompleteError`/`…IntegrityError` all present verbatim) — **this is now built**, not merely documented; 7L's "not implemented here" is stale |

**Hidden assumptions that depend on NIA witnessing the circle from
before activation** — the actual finding this ticket asks for:

1. `activateCircle` unconditionally creates **every** round `UPCOMING` and
   **every** obligation `OPEN`, regardless of whether that round's
   `dueDate` (derived from `startDate`, which can already be arbitrarily
   old once past-date validation is loosened — §2) is in the past. Nothing
   about activation itself assumes "the past has no history" — it simply
   has no *mechanism* to represent that history at all.
2. `round-lifecycle.service.ts`'s own doc comment (line 309) is explicit
   and load-bearing: round progression is "**never** based on `startDate`,
   `dueDate`, current date, a read, a login, or any financial activity —
   only [an] explicit call, by the owner." This is exactly the discipline
   the ticket wants preserved — elapsed time must never manufacture
   lifecycle state — and it is already true today, for every existing
   circle. Import must not weaken it.
3. `activateFirstRound` assumes **round 1 is the one that needs
   activating** (hardcoded `roundNumber === 1`) and its fresh-start
   precondition (line 372) requires **every** round to still be
   `UPCOMING`. For any circle whose round 1 is already `CLOSED` at
   activation time (exactly what an import must produce for rounds 1..K),
   this function can never activate round K+1 — it only ever
   replay-resolves round 1's already-closed state. **This is a genuine,
   confirmed gap — see §9/§11 below.**
4. `assessContributionClosureReadiness`/`assessPayoutClosureReadiness`
   (`src/domain/round-lifecycle.ts`) assume every fact they evaluate was
   produced by NIA's own ledger (`ContributionPayment`/`Payout` rows) and
   throw a genuine integrity error — never "incomplete" — the moment an
   obligation exists with **zero** backing rows at all ("No contribution
   obligations exist for this round" is the *only* zero-row case they
   tolerate, and that's an activation-integrity failure, not a
   legitimate business state). A round with real, owner-declared
   pre-NIA history but zero `ContributionPayment`/`Payout` rows is
   **indistinguishable, to this code, from corruption.** This is the
   single most important hidden assumption in the whole codebase for
   this ticket's purposes.
5. `completeCircle` (7L, now built) revalidates every round's financial
   closure via the same two predicates — so the same assumption applies
   transitively to circle completion, not just round closure.

## 2. Exact past-date restriction locations

**Exactly one authoritative rejection point exists, at exactly one layer:**

- `src/validations/circle.schema.ts:52–58` — `createDraftCircleSchema`'s
  `superRefine`: `if (value.startDate < todayUtcDateOnly())` →
  `"Start date cannot be in the past."` This is a Zod validation-layer
  check, called from `createDraftCircle` (`circle.service.ts:420`) before
  any database write.

**Everywhere else that is not a restriction, confirmed by direct
inspection:**

- **UI**: `app/(app)/circles/new/new-circle-form.tsx:152` sets
  `min={today}` on the native `<input type="date">`. This is a browser
  affordance only — trivially bypassed (dev tools, direct POST, a future
  API client) and enforces nothing the server doesn't already enforce
  independently. Not a second authoritative layer.
- **Service layer**: `createDraftCircle` (`circle.service.ts:412–443`)
  performs no date check of its own beyond the Zod parse above.
  `activateCircle` (`circle.service.ts:594–702`) performs **no** date
  check at all, at any point, fresh or replay.
- **Database/schema layer**: `SavingsCircle.startDate` is a plain
  `DateTime` column with no `CHECK` constraint, default, or trigger of any
  kind (`prisma/schema.prisma:217`).
- **Round/obligation generation**: `roundDueDate`
  (`circle-rotation-schedule.ts:44–56`) is pure date arithmetic from
  whatever `startDate` it's given — it has no floor, no "not before today"
  guard, and does not care whether its result is in the past. Verified:
  nothing in `activateCircle` filters, defers, or special-cases a round
  whose computed `dueDate` already elapsed.
- **Lifecycle readiness**: confirmed round-status is **never** inferred
  from any date (§1, finding 2) — `PayoutRoundStatus` is exclusively
  owner-action-driven.
- **Contribution/payout recording eligibility**: confirmed
  round-status-and-due-date-agnostic by explicit product sign-off (7J.1
  decision #1, 7K.1 item 3) — a past due date already neither authorizes
  nor blocks anything.

**Conclusion:** the *entire* mechanical apparatus below the one Zod
`superRefine` — due-date math, round/obligation generation, lifecycle
progression, contribution/payout recording eligibility — already
tolerates an arbitrarily old `startDate` **correctly and without
modification**. Permitting a past `startDate` is a one-line change to
`circle.schema.ts`. The ticket's own framing is exactly right, though:
that one-line change alone produces a circle that is *structurally*
importable but *historically empty* — activation would still create all
N rounds `UPCOMING` and all N² obligations `OPEN`, with zero payments and
zero payouts, silently discarding every contribution and payout that
already genuinely happened. The hard problem is never the date check; it
is everything in §3 onward.

## 3. "Existing SUSU" — minimum information needed

At minimum, the owner must supply, at DRAFT time, exactly what a new
circle already requires (name, currency, `contributionAmount`, `frequency`,
members, payout order) **plus**:

- **True original `startDate`** — already collected, just needs the
  past-date floor removed for this path specifically (§2).
- **Number of rounds already fully completed before import (`K`)** — a
  single integer, `0 <= K < N`. This is the one genuinely new scalar input
  V1 needs.

**Recommended: nothing else is required for V1.** Specifically rejected as
unnecessary bookkeeping (per the ticket's own explicit steer, §6/§13):
individual historical contribution amounts/dates per member/round,
individual historical payout dates, or any transaction-level re-entry for
rounds 1..K. Reasoning:

- The payout **order** for rounds 1..K is not new information — it is
  already required, unconditionally, for *every* circle (`N rounds` needs
  a complete 1..N order before activation even without import). The owner
  is already stating "who received round 4" as a side effect of stating
  the order at all; import adds no new input here, only a new
  *consequence* of that same input (§5).
- The contribution **amount** for rounds 1..K is not new information
  either — it is already frozen, circle-wide, from `contributionAmount`.
  V1 cannot represent a historical amount that differed from the current
  one (a genuine, disclosed limitation — see §17/§20).
- What genuinely cannot be safely defaulted or derived is **which rounds
  are done** — hence `K`, and nothing finer-grained, is the one new fact
  V1 truly needs from the owner for the completed-rounds boundary (§6/§17,
  Option B).

## 4/5. Historical provenance and the fabrication problem

**Current models cannot express "owner-declared history" vs.
"NIA-observed fact."** Every field this codebase treats as historically
authoritative — `ContributionPayment.confirmedById`/`confirmedAt`,
`Payout.confirmedByMemberId`/`confirmedAt` — is defined, throughout every
Phase 7 freeze document, as **the actual actor who performed the actual
NIA-mediated action, at the actual moment they performed it.** There is no
existing column, enum value, or convention anywhere in this schema that
means "the owner asserts this happened, but NIA did not witness it."

Concretely, what the ticket explicitly forbids is exactly what today's
schema would force an importer to do if it reused ordinary writers
unmodified:

- To make round 4 (already historically complete) appear `CLOSED` under
  `assessContributionClosureReadiness`, an importer would have to insert a
  real `ContributionPayment(status=CONFIRMED, confirmedById=<owner>,
  confirmedAt=<today>)` for every one of that round's N obligations — a
  **fabricated confirmation NIA never performed**, dated to the import
  moment, not the true (unknown, unwitnessed) historical moment.
- To make round 4's payout appear `CONFIRMED`, an importer would have to
  either fabricate `confirmedByMemberId`/`confirmedAt` directly (bypassing
  the recipient's own member-session-authenticated confirm action
  entirely — a privilege no existing writer has, per 7K.1 item 4's own
  "the owner cannot confirm for the recipient" rule) or make the true
  historical beneficiary log into NIA *today* and click "confirm" for
  money they received two months ago through an app that didn't exist for
  them at the time — which would produce a **true action, false
  implication**: NIA's own record would read as "the recipient confirmed
  this payout via NIA's workflow," when in fact NIA's workflow never
  mediated it at all.

Both are exactly the "manufacture a financial confirmation NIA never
observed" failure mode the ticket names by number. **Provenance must
therefore become an explicit, first-class fact, not an inferred one.**
Recommended minimum provenance surface (conceptual — no migration here,
see §18):

- `SavingsCircle.originKind: NEW | IMPORTED` (default `NEW`) +
  `importedAt`/`importedById` (nullable, mirrors every other
  actor/timestamp provenance pair already in this schema —
  `activatedAt`/`activatedById`, `completedAt`/`completedById`).
- A **round-level** discriminator, `PayoutRound.closureBasis: OBSERVED |
  IMPORTED` (default `OBSERVED`) — the single fact that lets every
  ledger-trusting predicate downstream (§6/§9) tell "this round's `CLOSED`
  status is backed by a real, re-derivable ledger" apart from "this
  round's `CLOSED` status is the owner's explicit, dated-at-import
  declaration about pre-NIA history."
- Matching **obligation-level** and **payout-level** discriminators
  (`ContributionObligation.fulfillmentBasis: LEDGER | IMPORTED`,
  `Payout.confirmationBasis: MEMBER_CONFIRMED | IMPORTED`), so that even
  within an imported round, the *shape* every existing read model already
  expects (one obligation per member, one payout per round) is preserved,
  while the *authority* backing "why is this fulfilled/confirmed" remains
  honestly distinguishable forever.

This is Option C from the ticket's own §7/§8 menu — see §7/§8 below for
why it is preferred over the alternatives.

## 6. Round reconstruction (the 10-member, K=6, round 7 example)

Given the provenance model in §5, rounds 1–6 are represented as: `status =
CLOSED`, `closureBasis = IMPORTED`, `activatedAt = closedAt = <import
timestamp>`, `activatedById = closedById = <owner>` — satisfying
`assertRoundLifecycleStateIntegrity`'s existing per-round provenance rule
unchanged (a `CLOSED` round must carry both activation and closure
provenance — it does not care *why*, only that it's coherently present).
Each round's N obligations: `status = FULFILLED, fulfilledAt = <import
timestamp>, fulfillmentBasis = IMPORTED`. Each round's one `Payout`:
`status = CONFIRMED, confirmationBasis = IMPORTED, confirmedByMemberId =
NULL` (never fabricated — the round's recipient is already known via
`PayoutRound.recipientId`; there is no need to also claim a confirming
member action that never occurred through NIA).

Round 7 (the round underway at import) and rounds 8–10: created exactly as
an ordinary fresh activation already leaves every round — `UPCOMING`,
`OPEN` obligations, no payout row. **Zero special-casing needed for
8–10.** Round 7 needs one additional decision — see §7 below — but
requires no new schema of its own beyond what §5 already introduces.

This satisfies every constraint the ticket names:

- **Does not restart at round 1** — round numbers are preserved exactly as
  activation always assigns them (1..N by `payoutOrder`); "restart" isn't
  possible under this model because rounds 1–6 are marked historically
  `CLOSED`, not silently dropped or renumbered.
- **Does not mark future rounds complete** — 8–10 are `UPCOMING`, `OPEN`,
  untouched.
- **Does not infer completion from elapsed dates** — completion for 1–6 is
  an explicit owner declaration (`K`), never derived from
  `dueDate < today`.
- **Creates no false financial confirmation** — every imported fact is
  tagged `IMPORTED`, distinguishable forever from a real observed one.
- **Does not allow a beneficiary to receive twice** — `@@unique([circleId,
  recipientId])` on `PayoutRound` already makes this structurally
  impossible, completely unmodified; the payout order the owner declares
  at DRAFT time (§3) is exactly what fixes each historical round's
  recipient, exactly as today.
- **Does not lose the original payout order** — the order is exactly the
  DRAFT-time input, frozen at activation exactly as today; import changes
  nothing about *how* payout order becomes permanent, only adds the `K`
  boundary on top of it.

## 7/8. Partial current round, and the contribution/payout history option comparison

**The harder case, evaluated per the ticket's own instruction to prefer
the smaller boundary:** round 7 is underway; some members have paid, the
recipient may or may not have received their payout.

**Recommended: the simpler boundary.** *"Import through the last fully
completed round (K), then begin NIA tracking from the next round
(K+1)."* Round K+1 (round 7 in the example) is imported as an **ordinary
fresh round** — `UPCOMING`/`OPEN`, `closureBasis = OBSERVED` — with no
attempt to reconstruct whatever partial state it had before import.
Anything a member already paid toward round 7 *before* import is recorded,
after import, through the **existing, already-approved "late/catch-up
contribution" path** (7J.1 decision #1: any persisted obligation accepts
a recording regardless of due date) — the owner records it the same way
they would record any late payment, `recordedAt = now`. This is not a new
capability; it is the exact mechanism already frozen for ordinary late
contributions, reused unmodified.

**Why not import the partial round too:** doing so would require the
same per-member historical-payment detail the ticket explicitly warns
against turning onboarding into ("Avoid turning onboarding into
bookkeeping for every historical payment unless domain correctness truly
requires it") — for a case that, unlike rounds 1..K, has **no clean
completion boundary to declare**: "3 of 10 members paid" is not a single
scalar like `K`, it's a per-member table, and getting it wrong is far
more likely (partial states are exactly where owner recollection is
least reliable). The cost of the simpler boundary is honest and small:
NIA's own `recordedAt` for those late catch-up entries will read as
"today," not the true (already-happened) date — but that is **already**
true for every ordinary late contribution recorded in this codebase
today (nothing currently claims `recordedAt` is the true payment date for
*any* contribution) — so V1 introduces no new kind of imprecision here,
only extends an existing, accepted one to the import case.

**Comparing the ticket's own A–E options for contribution history, applied
to this recommendation:**

| Option | Verdict |
|---|---|
| A. Normal `ContributionPayment(status=CONFIRMED)` rows for 1..K | **Rejected** — fabricates confirmations NIA never observed (§4/§5); the *only* way to satisfy `amountMatchesObligation`/`isObligationFulfilled` without a real backing row is to insert a fake one. |
| B. Special imported historical records (a dedicated new model) | Workable, but strictly more schema than needed — every fact a dedicated `ImportedRoundHistory` model would carry (round id, "fulfilled", timestamp, actor) already has a home on the existing `ContributionObligation`/`Payout` rows once a `*Basis` discriminator exists (§5). Adds a second place every future read model must remember to check. |
| C. Aggregate historical completion state via a provenance discriminator on the existing rows | **Recommended.** Smallest schema delta; every existing read model that already queries `ContributionObligation`/`Payout` by round continues to work with zero query changes for the common (non-import) case, and gains one new column to branch on for the import case. |
| D. No transaction-level history at all | **Rejected** — cannot satisfy the N² obligation structural invariant (`assertActivatedRotationStructureIntegrity` requires exactly N² rows, no exceptions) without a parallel activation path (§9, rejected below), and leaves member-facing "did I already pay this round" history genuinely blank for imported rounds — a real regression from what a new circle's member dashboard already shows. |
| E. Another explicit model | Not found to be necessary; C already closes every gap the audit surfaced. |

**Consequences of Option C, evaluated per the ticket's own list:**
contribution-closure-readiness and round-closure both require amending
`assessContributionClosureReadiness`/`assessPayoutClosureReadiness` to
treat `*Basis = IMPORTED` as satisfied-by-declaration rather than
ledger-summed (§9/§11 — the one place this ticket's recommendation
genuinely touches frozen Phase 7 domain logic, not just schema). Member
history and aggregate progress continue to work through the *same*
`status`/`confirmedAmount`-shaped fields every existing read model
already renders — an imported-fulfilled obligation still reads
`FULFILLED` to a member dashboard that has never heard of `IMPORTED`.
Financial auditability is preserved (arguably improved over Option A: an
auditor can tell *at a glance* which money changed hands through NIA and
which didn't, instead of it looking identical to a real confirmation).
Future corrections remain exactly as constrained as today — nothing here
introduces a reversal path Phase 7 didn't already have (a wrong `K` is a
DRAFT-time, pre-activation correction only; see §14). Privacy is
unaffected — no new PII surface. Replay/idempotency: the reconstruction
step must itself be replay-safe (§9).

## 9. Activation implications

**Recommended: Option A — reuse normal `activateCircle` unmodified for
structure, then run a narrow, additive reconstruction step for rounds
1..K, inside the *same* locked transaction.**

Rejected alternatives, per the ticket's own menu:

- **Option B (separate import-activation service)** — would duplicate
  `activateCircle`'s own N-round/N²-obligation generation logic
  (`roundDueDate`, payout-order-to-recipient mapping, frozen
  amount/currency snapshotting). This codebase has consistently avoided
  exactly this kind of parallel-but-almost-identical domain logic
  elsewhere (7J.1 §8's own "build a small, parallel, owner-scoped
  repository function rather than widen a member-facing one" is about
  *reads*, not writes — for *writes*, the established discipline, see
  every 7K/7L section on "reuse, never reimplement," is stronger: never
  duplicate a generator). A second generator is a second place the N²
  invariant can silently drift.
- **Option C (create imported historical structure directly, skipping
  normal generation)** — same drift risk, worse: it would need to
  independently reproduce every one of `assertActivatedRotationStructureIntegrity`'s
  invariants (member-count, payout-order-to-round mapping, frozen
  amount/currency, due-date recurrence) by hand for the imported case,
  with no shared code path to guarantee it matches what
  `assertActivatedRotationIntegrity` re-verifies on every subsequent read.

**Option A's shape, concretely:** `activateCircle` runs exactly as today,
producing all N rounds `UPCOMING` and all N² obligations `OPEN` — no
branch inside `activateCircle` itself needs to know about import at all.
Immediately afterward, **inside the same `lockSavingsCircleForUpdate`
transaction**, a new function (e.g. `reconstructImportedRoundHistory`)
runs only when `circle.originKind === "IMPORTED"` and `K > 0`: it CAS-
updates rounds 1..K to `CLOSED`/`IMPORTED` and their obligations to
`FULFILLED`/`IMPORTED`, and inserts one `Payout` row per round with
`CONFIRMED`/`IMPORTED` (§6). This must happen in the *same* transaction —
not a second, separate one — because every existing read model (owner
overview, member dashboard, round-lifecycle read) has no concept of an
"ACTIVE but not yet reconstructed" circle; letting that intermediate
state ever commit and become visible would render a live circle with six
rounds of *emptied* money, which is a **worse**, user-visible
inconsistency than the DRAFT-startDate gap this ticket is trying to
close.

**Locks, idempotency, exact member count, payout order, frozen
amounts/currency, due dates, lifecycle state, provenance** — audited one
by one:

- **Locks**: unchanged — the identical, already-shared
  `lockSavingsCircleForUpdate`, held for the whole (now larger)
  transaction. No new lock primitive, no new deadlock-ordering risk (the
  reconstruction step touches only rows already reachable from the circle
  it holds locked).
- **Idempotency**: the reconstruction step must itself be safely re-runnable, mirroring `activateCircle`'s own existing ACTIVE-replay branch (line 627: `if (circle.status === "ACTIVE") { assertActivatedRotationIntegrity(...); ... }`) — a second call against an already-imported ACTIVE circle must re-verify the existing `IMPORTED`-tagged rows are still coherent and return the same result, **never** re-stamp a fresh `importedAt`/re-run the CAS writes. This is new code, not reused, but the *shape* (re-check under lock, replay on match, integrity-error on mismatch) is a direct port of every other CAS writer in this codebase.
- **Exact member count / payout order**: unchanged — the DRAFT-time payout order the owner already had to set is the *only* input that determines which historical round belongs to which member; import adds no second, independent "who received what historically" input to reconcile against the first (this is precisely why §3 recommends *not* asking for it twice).
- **Frozen amounts/currency**: unchanged — imported obligations/payouts still derive their amount from `circle.contributionAmount`/`currency` exactly like every other obligation; V1 cannot represent a historical amount that differed (§3, disclosed limitation).
- **Due dates**: unchanged — `roundDueDate` computed from the true (now possibly past) `startDate`, exactly as §2 already established works correctly today.
- **Lifecycle state**: extended, not contradicted — `assertRoundLifecycleStateIntegrity`'s three-phase shape (CLOSED-prefix, ≤1 ACTIVE, UPCOMING-suffix) already legitimately describes "rounds 1–6 CLOSED, 7–10 UPCOMING" without any change to that function at all. The gap is downstream, in round-lifecycle *service* preconditions — see §11.
- **Provenance**: this is the entire point of §5 — new, explicit, and never silently inferred.

## 10. Lifecycle invariants — classified

| Invariant | Classification | Why |
|---|---|---|
| `DRAFT → ACTIVE → COMPLETED` | **UNCHANGED** | Import circles follow the identical state machine; only DRAFT-phase *inputs* differ (past `startDate`, `K`). |
| Member/payout-order immutability after activation | **UNCHANGED** | Import still requires the full order set in DRAFT before activation, exactly as today — and getting it right for historical rounds matters *more*, not differently (§14). |
| N rounds | **UNCHANGED** | |
| N² obligations | **UNCHANGED** | This is exactly why obligations must still be created for imported rounds, never skipped (rejects Option D, §7/§8). |
| One recipient per round | **UNCHANGED** | `@@unique([circleId, recipientId])`, untouched. |
| Each member receives exactly once | **UNCHANGED** | Same constraint covers historical and future rounds identically. |
| Exact frozen contribution amounts | **UNCHANGED, with a disclosed V1 gap** | Imported obligations still get `expectedAmount = circle.contributionAmount`; if the real SUSU's amount changed over its pre-NIA history, V1 cannot represent that (§3/§17 non-goal). |
| Contribution readiness | **EXTENDED** | `assessContributionClosureReadiness` gains an `IMPORTED`-basis satisfied-by-declaration branch, alongside its unchanged ledger-derived branch. |
| Payout readiness | **EXTENDED** | `assessPayoutClosureReadiness` gains the analogous branch. |
| Strict round progression / at most one ACTIVE round | **EXTENDED (structurally); MUST BE AMENDED (at the service-precondition layer)** | `assertRoundLifecycleStateIntegrity` already tolerates "CLOSED-prefix, then UPCOMING" with zero ACTIVE rounds as a legitimate shape (it is, today, the "every round UPCOMING" shape's twin — a `CLOSED`-prefix variant of the same zero-ACTIVE case) — so the pure structural check needs **no change**. But `activateFirstRound` (`round-lifecycle.service.ts:313–399`) hardcodes `roundNumber === 1` and its fresh-start precondition (line 372) requires **every** round to be `UPCOMING`. For an imported circle with rounds 1..K already `CLOSED`, round 1 immediately resolves as an inert **replay** (lines 337–339) and round K+1 can **never** be activated by any existing writer — `advanceRound` requires a pre-existing `ACTIVE` round, which never gets created. **This is a genuine, confirmed gap, not a hypothetical one** — see §11. |
| Explicit first-round start | **MUST BE AMENDED** | Same finding — "first round" must become "the first round in the UPCOMING phase immediately following any CLOSED prefix," not literally round 1. |
| Final-round closure | **UNCHANGED** | `advanceRound`'s own closure logic (contributions fulfilled + payout confirmed, re-derived) is untouched; it only needs the readiness predicates' `IMPORTED`-branch extension (already counted above) to ever apply to rounds that use it. |
| Explicit completion | **UNCHANGED** | `completeCircle`'s own precondition ("every round `CLOSED`," revalidated via the same two predicates) needs no change beyond the predicates' own extension already counted above — it does not care *why* a round is `CLOSED`. |
| Replay/idempotency | **EXTENDED** | Import's own reconstruction step needs its own replay discipline (§9), net-new but shaped identically to every existing CAS writer. |
| Shared locking | **UNCHANGED** | Same lock, larger transaction (§9). |
| Completed read-only behavior | **UNCHANGED** | A completed imported circle behaves exactly like a completed native one — nothing about `*Basis = IMPORTED` changes any read-only/completed-state rule. |

## 11. Date semantics

- **Round due dates**: derived, unchanged, from the true (possibly past)
  `startDate` via the existing, unmodified `roundDueDate` — already
  correct for historical dates (§2). Monthly month-end clamping and
  weekly/biweekly fixed-offset math are pure functions of `startDate` and
  need no import-awareness at all.
- **Obligation due dates**: identical — frozen at creation from the
  round's own `dueDate`, already correct for the past.
- **Current/future schedule**: rounds K+1..N get exactly the due dates
  `roundDueDate` already computes; nothing about import perturbs any
  round after the boundary.
- **Elapsed time must never manufacture financial/lifecycle events** — the
  central discipline this whole audit protects: `K` is a **declared**
  fact from the owner, never derived from "how many `dueDate`s have
  already passed" (an owner could, and legitimately might, declare `K`
  smaller than "however many rounds' due dates have elapsed," e.g. if the
  real SUSU ran behind schedule — the model must never second-guess or
  auto-correct the owner's declared `K` against elapsed-date arithmetic).
- **`importedAt`/`closedAt` for imported rounds** must be the real, fresh
  "now" at the moment NIA is told, **never** backdated to the (unknown,
  unwitnessed) true historical date — mirroring 7L's own frozen rule for
  `completedAt` exactly ("even when two events happen within the same
  second, they remain two distinct historical events with two distinct
  timestamps"; here, the two distinct events are "the real-world round
  closure" and "NIA learning about it," and only the second one is a fact
  NIA can honestly timestamp). The round's own `dueDate` remains the
  honest carrier of "roughly when this really happened" — no second,
  false-precision "true closure date" field is needed (§5).

## 12. Member auth

**Confirmed: no change needed.** `CircleMember.memberCode`/`pinHash` are
created at `addDraftCircleMember` — DRAFT time, identical for import and
new circles. Member-session eligibility
(`circle-member-session.service.ts:25`, `ELIGIBLE_CIRCLE_STATUSES = new
Set(["ACTIVE", "COMPLETED", "ARCHIVED"])`) already keys off
`circle.status`, not on anything import-specific — so a historical
member's Circle ID + Member Code + PIN become usable at exactly the same
moment as today: the instant `activateCircle` transitions the circle
`DRAFT → ACTIVE`, regardless of whether that circle happens to have six
rounds of `IMPORTED`-basis history sitting behind it. No phone
authentication is introduced or needed.

## 13. User experience contract

Recommended smallest truthful creation flow:

> **How are you setting up this SUSU?**
> ○ Starting a new SUSU
> ○ Importing a SUSU already in progress

For **Import**, additional required inputs, and nothing more:

1. True original start date (same field, past dates now accepted on this
   path only — §2/§17).
2. Number of rounds already fully completed (`K`), with the UI stating
   the consequence plainly: *"Rounds 1 through K will be recorded as
   already complete, based on your word — NIA did not observe them
   happening."*
3. The existing member list + payout order flow, unchanged — but the UI
   should make explicit, next to each of the first K positions in that
   order, that this member has *already* received their round.

**Explicitly not asked for**, matching the ticket's own steer: individual
historical contribution dates/amounts per member/round, individual
historical payout dates, or any per-transaction re-entry. The current
round (K+1) is presented after import exactly like any other live round —
the owner records any already-known late/partial contributions for it
through the ordinary contribution-recording flow, with plain copy
disclosing that NIA records it as of today, not as of when it truly
happened (§7).

## 14. Failure / correction model

- **DRAFT, before activation**: `K`, `startDate`, member list, and payout
  order remain exactly as editable as they already are today for a
  brand-new circle — nothing about import needs a *different* correction
  story pre-activation, because nothing importable has been committed
  yet. Wrong `K`, wrong historical recipient, wrong original start date,
  wrong payout order: all freely correctable up until the single
  `activateCircle` call, exactly like today.
- **Import abandoned halfway / retry after network failure / duplicate
  submission**: covered by the same idempotency discipline every other
  SUSU writer already uses (§9) — a retried `activateCircle`+reconstruction
  call against an already-imported `ACTIVE` circle resolves as a replay,
  never a second write, never a partial state visible in between (the
  reconstruction step runs inside the same lock as activation itself).
- **Owner discovers a mistake after import activation (`K` was wrong, a
  historical recipient was wrong)**: **must be exactly as immutable as
  every other post-activation mistake already is today** — this codebase
  has no reversal/correction workflow for a mis-confirmed contribution or
  a mis-recorded payout (7J §9, 7K.1 item 2, both explicit, approved
  non-goals), and this audit finds no reason import history should be
  held to a *looser* standard than history NIA itself observed. A wrong
  `K` discovered post-activation is, deliberately, an out-of-band
  administrative matter — not a self-service undo — exactly mirroring the
  existing posture on a mis-confirmed `ContributionPayment`/`DISPUTED`
  `Payout`. **No destructive history-editing path is introduced.**

## 15. Existing-data compatibility

Every recommendation above is additive and default-preserving:
`originKind`/`closureBasis`/`fulfillmentBasis`/`confirmationBasis` all
default to the "native, NIA-observed" value for every column on every
existing row, with zero backfill required beyond the default itself
(`NEW`/`OBSERVED`/`LEDGER`/`MEMBER_CONFIRMED`). The existing new-circle
workflow, existing contribution/payout services, existing member sessions,
and existing completion semantics are **untouched in their default-value
behavior** — the only functions that gain new logic
(`assessContributionClosureReadiness`, `assessPayoutClosureReadiness`,
`activateFirstRound`/its round-1-only precondition) gain an *additional
branch*, never a change to their existing branch's behavior for
`LEDGER`/`MEMBER_CONFIRMED`/native rows. No existing row anywhere needs
fabricated historical data to remain valid under the new columns' default
values.

## 16. Security / authority

**Confirmed: owner-only, unchanged.** Every existing SUSU mutation in this
codebase is owner-authenticated via `requireUser()` at the action
boundary, with ownership re-verified fresh under the circle lock (7J §6,
7K §7/§16, 7L §32) — this audit finds no reason import should differ:
`K`, the imported `startDate`, and every historical declaration are owner
inputs, authorized exactly like every other DRAFT-phase input already is.
No imported fact grants a member any new authority: member-session
identity (`requireCircleMember`) plays no role in import, exactly as it
plays no role in activation today; recipient confirmation authority
(`confirmedByMemberId === round.recipientId`) is not bypassed —
imported payouts deliberately leave `confirmedByMemberId = NULL` rather
than forging a recipient action (§5/§6), so no future member-facing read
or write could ever be misled into treating an imported payout as
something a specific member session actually confirmed. Financial
integrity is not weakened: the `*Basis = IMPORTED` discriminator is
strictly additive information, never a bypass of any existing check for
native rows.

## 17. Recommended V1 architecture

**Option C — a historical-state/provenance model, restricted to the
completed-round boundary (Option B's scope), built via reused activation
plus a narrow reconstruction step (Option A's activation shape).**

Comparing the three named options directly:

- **Option A (full transaction-level historical import)** — **rejected.**
  Requires either per-member-per-round transaction re-entry at onboarding
  (violates the ticket's own "avoid turning onboarding into bookkeeping"
  instruction) or fabricating confirmations NIA never observed if the
  owner doesn't have that granularity (violates §4's central prohibition).
  Even if the owner *did* have perfect records, this option still forces
  every historical `ContributionPayment`/`Payout` row to carry a real
  actor/timestamp pair that did not, in fact, occur through NIA — the
  provenance problem exists regardless of how much detail is collected.
- **Option B (import through a completed-round boundary, begin detailed
  accounting from the next round)** — this is the right **scope**
  decision (§6/§7: K completed rounds, then ordinary live tracking from
  K+1) but, taken literally and alone, says nothing about *how* rounds
  1..K are represented — it under-specifies the provenance problem this
  audit's §4/§5 exists to answer.
- **Option C (historical-state/provenance model)** — this is the right
  **representation** decision, but by itself doesn't say *how much*
  history to represent — it needs a boundary.

**Recommendation: combine B's scope with C's representation.** Import
rounds 1..K using the provenance-tagged model (§5/§6); leave K+1..N as
ordinary fresh rounds, tracked live from the moment of import onward
(§7). This is the smallest model that is simultaneously: **historically
truthful** (every fact is either a real NIA-witnessed event or an
explicitly-tagged owner declaration, never conflated — §4/§5);
**auditable** (an operator can query `*Basis` and know exactly which
money changed hands through NIA vs. was declared at import); **understandable**
(one new scalar owner input, `K`, plus a handful of default-`false`-shaped
discriminator columns — no new mental model beyond "this round predates
NIA"); **compatible with frozen Phase 7** (§10/§15 — every invariant is
either unchanged or additively extended, with exactly one confirmed
service-layer gap to amend — §11); **practical for Burkina Faso SUSU
onboarding** (one date, one integer, the payout order the owner already
has to provide — no per-transaction re-entry); and **not unnecessarily
complex** (rejects both a fully general historical ledger and a
zero-history "no import" shortcut).

## 18. Migration consequences (conceptual only — no migration files)

New enums (conceptual):

- `CircleOriginKind { NEW, IMPORTED }`
- `RoundClosureBasis { OBSERVED, IMPORTED }`
- `ContributionFulfillmentBasis { LEDGER, IMPORTED }`
- `PayoutConfirmationBasis { MEMBER_CONFIRMED, IMPORTED }`

New fields (all nullable-or-defaulted, all backfillable with a single
static default, no data migration logic needed):

- `SavingsCircle.originKind` (default `NEW`), `importedAt` (nullable),
  `importedById` (nullable FK → `User`, `onDelete: Restrict` — matching
  every other actor-provenance FK in this schema).
- `PayoutRound.closureBasis` (default `OBSERVED`).
- `ContributionObligation.fulfillmentBasis` (default `LEDGER`).
- `Payout.confirmationBasis` (default `MEMBER_CONFIRMED`).

**Compatibility with existing circles**: every existing row gets the
default value with zero behavioral change, because every existing
consumer's `status === "FULFILLED"`/`status === "CONFIRMED"` check is
untouched — only the two closure-readiness predicates and the
first-round-activation precondition gain new branches that key off these
columns, and every one of those branches is a no-op for the default
value.

**Indexes/constraints likely required**: none beyond what already exists
— `*Basis` columns are read alongside `status`/`roundId`/`circleId` in
queries the existing indexes (`ContributionObligation_circleId_roundId_status_idx`,
etc.) already cover; no new composite index is implied by anything in
this audit. No new unique constraint is needed — the existing
`@@unique([circleId, recipientId])`/`@@unique([roundId])` continue to be
the sole enforcement of "one recipient per round"/"one payout per round,"
unchanged, for both native and imported rows alike.

## 19. Test plan (future — none implemented here)

- New SUSU (no import) — every existing test suite, byte-for-byte
  unaffected (default-value regression coverage).
- Imported circle at the completed-round boundary — activation produces
  exactly K `CLOSED`/`IMPORTED` rounds and N−K `UPCOMING`/`OBSERVED`
  rounds; obligation/payout counts still exactly N and N² respectively.
- Past start date accepted only when `originKind === IMPORTED`; still
  rejected for `NEW`.
- Correct due-date reconstruction for historical rounds (weekly/biweekly/
  monthly, including month-end clamping) against a genuinely old
  `startDate`.
- No fake financial confirmation: assert no `ContributionPayment`/`Payout`
  row is ever created for an imported round (only the obligation/payout
  rows themselves, tagged `IMPORTED`, with no confirming member action
  recorded).
- Correct next round: round K+1 is `UPCOMING`, and — the confirmed gap
  from §11 — the amended first-round-activation precondition correctly
  activates K+1 (not round 1) when rounds 1..K are `CLOSED`/`IMPORTED`.
- Each beneficiary exactly once, across the imported/native boundary —
  the existing `@@unique([circleId, recipientId])` constraint test,
  extended to cover an imported cohort.
- Member auth: an imported circle's members can log in the instant
  activation completes, identically to a native circle.
- Duplicate import/replay: a retried activation+reconstruction call
  against an already-imported `ACTIVE` circle writes nothing new and
  returns the original result.
- Invalid historical state: `K >= N`, `K < 0`, or a `startDate` that
  doesn't coherently precede `dueDate(K)` are all rejected before any
  write.
- Final-round edge: `K = N − 1` (only the current round remains) and
  `K = 0` (import with zero completed rounds, i.e., a pure past-start-date
  case with no reconstruction at all) both behave correctly.
- Completion: `completeCircle` succeeds for a fully-imported-then-
  fully-progressed circle, with the amended readiness predicates
  correctly treating `IMPORTED`-basis rounds as satisfied.
- Existing circle compatibility: every pre-9B fixture/test continues to
  pass unmodified against the new, additively-defaulted schema.

## 20. Future implementation-ticket decomposition (proposed, not built)

Mirroring the narrow-ticket-sequence precedent already used for 7J/7K:

1. **9B.1** — Schema: the four new enums/columns (§18), migration only,
   no service/action/UI change; every existing test must pass unmodified.
2. **9B.2** — Domain: extend `assessContributionClosureReadiness`/
   `assessPayoutClosureReadiness` with the `IMPORTED`-basis branch (§9/§10);
   pure, framework-free, unit-testable in isolation exactly like the
   existing predicates.
3. **9B.3** — Domain: generalize `activateFirstRound`'s precondition from
   "every round `UPCOMING`" to "every round before the target is `CLOSED`,
   the target is `UPCOMING`, every round after remains `UPCOMING`" (§11) —
   the one confirmed, load-bearing amendment to frozen Phase 7 this audit
   found. Live-fixture + concurrency tests required, matching 7K.13's own
   discipline for this exact function.
4. **9B.4** — Validation: loosen `createDraftCircleSchema`'s past-date
   check to be conditional on `originKind` (§2), plus a new schema for the
   `K` input.
5. **9B.5** — Service: the reconstruction step (§9), circle-lock-scoped,
   replay-safe, called only from within `activateCircle`'s own transaction
   for `originKind === IMPORTED`.
6. **9B.6** — Server Action + owner UI: the "new vs. import" choice, the
   `K` input, and the payout-order screen's "already received" annotation
   (§13).
7. **9B.7** — Live concurrency verification for the reconstruction step
   and the amended `activateFirstRound`, mirroring 7K.13's/7J.9's own
   dedicated concurrency-guard tickets.

## 21. Unresolved questions / blockers

1. **Historical amount drift.** If the real SUSU's contribution amount
   changed partway through its pre-NIA history, V1 as recommended cannot
   represent that (§3/§10) — every imported obligation gets the circle's
   single frozen `contributionAmount`. This is treated here as an
   accepted, disclosed V1 non-goal, not a blocker, but it is a genuine
   product decision, not an engineering one, and should be confirmed by
   whoever owns the Burkina Faso SUSU onboarding requirements before
   9B.1 ships.
2. **Currency drift** — same shape, same recommendation (accepted V1
   non-goal), for a SUSU whose contribution currency changed historically.
3. **What happens if the owner later discovers `K` was wrong, after
   activation** — §14 recommends treating this identically to every other
   post-activation financial mistake in this codebase (an out-of-band
   administrative matter, no self-service reversal). This is consistent
   with existing precedent but is itself a product decision worth an
   explicit sign-off, exactly like 7J §9/7K.1 item 2 each required one.
4. **Whether `Payout.confirmationBasis = IMPORTED` payouts should ever
   become disputable** — this audit recommends **no** (there is no
   member-session action to dispute; the recipient never confirmed
   anything through NIA to begin with), but this should be an explicit
   frozen decision, not merely this audit's inference, before 9B.5 is
   implemented.

**Conclusion:**

## DOMAIN DECISION REQUIRED

Not because the architecture is unclear — §17's recommendation (Option C
representation + Option B scope, built via Option A's activation shape) is
this audit's confident answer, and §9's `activateFirstRound` gap is a
concrete, verified, fixable finding, not an open question. This concludes
**DOMAIN DECISION REQUIRED** rather than **READY FOR IMPLEMENTATION
DESIGN** specifically because §21's four items are genuine product-owner
decisions (historical amount/currency drift, post-activation `K`
correction policy, imported-payout dispute eligibility) that this audit
cannot resolve unilaterally — exactly the same posture 7K.1 required
before *its* audit's recommendations became binding. Once those are
signed off (mirroring the 7J.1/7K.1 sign-off pattern this codebase already
uses twice), this document's §17–§20 are implementation-ready as written.
