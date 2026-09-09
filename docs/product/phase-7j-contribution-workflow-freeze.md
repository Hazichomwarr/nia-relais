# Phase 7J — SUSU Contribution Workflow: Freeze Document

Status: **READY TO FREEZE.** This document is the authoritative, final V1
contract for the SUSU contribution workflow (record → confirm/reject),
superseding the proposals in `docs/product/susu-contribution-workflow-audit.md`
(7J.1) with what 7J.2–7J.7 actually built and 7J.8 verified. That earlier
document remains valid as the historical design record; nothing in it was
found to be inaccurate, so it is not amended by this ticket.

Audited: 7J.8, against the code as it exists after 7J.7 (owner contribution
desk UI). No product code changed as a result of this audit — no P0 or P1
defect was found (see "Audit result" below).

## 1. Authoritative entities

**`ContributionObligation`** — one row per (round, member), created only at
`activateCircle`. Frozen forever: `expectedAmount`, `currency`, `dueDate`,
`roundId`, `memberId`. Its own `status` (`OPEN`/`FULFILLED`) is written by
exactly one path (`confirmContribution`, atomically with the payment it
confirms) and is a **lifecycle projection**, not the source of financial
truth — see §3.

**`ContributionPayment`** — one row per recording attempt. Immutable once
created except for the single terminal transition out of `RECORDED`:
`amount`, `currency`, `recordedAt`/`recordedById`, `clientOperationId` never
change after insert; `confirmedAt`/`confirmedById` or
`rejectedAt`/`rejectedById`/`rejectionReason` are set exactly once, on
exactly one of the two outgoing transitions.

## 2. Allowed transitions

```
ContributionPayment:   (none) -> RECORDED -> CONFIRMED   (terminal)
                                           -> REJECTED    (terminal)
ContributionObligation: OPEN -> FULFILLED                (terminal)
```

Enforced in code by `src/domain/contribution-state.ts`
(`isContributionPaymentTransitionAllowed`,
`isContributionObligationTransitionAllowed`) and backstopped at the database
level by the partial unique index
`ContributionPayment_one_unresolved_or_confirmed_per_obligation_idx` on
`(obligationId) WHERE status IN ('RECORDED','CONFIRMED')`. No reversal or
correction path exists or is planned for V1 — a mis-confirmed payment is an
out-of-band administrative matter (7J audit §9, reaffirmed unchanged).

A `REJECTED` payment does **not** block a fresh attempt: the partial index
excludes `REJECTED`, so `record → reject → record → confirm` is the
supported "retry after rejection" flow, and the original `REJECTED` row is
permanent history (§3).

## 3. Historical authority

**If current state and historical rows ever disagree, the historical
`ContributionPayment` ledger is authoritative for money; `ContributionObligation.status`
is a convenience projection, never the source of truth.**

- `expectedAmount`/`currency`/`dueDate` on `ContributionObligation` are
  frozen at activation and never re-read from the circle's live terms.
- `ContributionPayment.amount`/`currency`/`recordedAt`/`recordedById` never
  change after insert; confirmation/rejection add exactly one new
  provenance pair, once.
- `confirmedAmount` (both read models) is always `SUM(amount) WHERE status
  = 'CONFIRMED'` over the live ledger — never `obligation.status` and never
  a cached counter.
- A `REJECTED` payment's own validity is judged only against its own row's
  internal consistency, never against its obligation's *current* status —
  verified in code and by dedicated tests (7J.4.1, see
  `contribution-rejection.service.ts`'s `resolveRejectedReplay` and
  `contribution-rejection.service.test.ts`'s "7J.4.1: a legitimate rejection
  replay succeeds after a later, different payment fulfills the
  obligation"). Concretely: `record A → reject A → record B → confirm B`
  leaves the obligation `FULFILLED` while `A` remains permanently, correctly
  `REJECTED`, and replaying `A`'s rejection still succeeds.
- The owner desk renders every payment attempt (`RECORDED`/`CONFIRMED`/`REJECTED`
  alike) — confirmed by `contribution-desk-display.test.ts` and
  `contribution-owner-read.service.test.ts`'s "a rejected attempt remains
  visible in payment history after a later payment fulfills the
  obligation." Nothing collapses `REJECTED A + CONFIRMED B` into "paid".

No code path anywhere reconstructs a historical financial fact from
current circle/member/round data (checked across all three services, both
read models, and the UI layer).

## 4. Accounting rules

Single shared source for every accounting computation:
`src/domain/contribution-accounting.ts` (`toMoney`, `clampToZero`,
`amountMatchesObligation`, `isObligationFulfilled`) — `Prisma.Decimal`
throughout, formatted to a fixed-2 string only at the final serialization
boundary. No JavaScript floating-point arithmetic exists anywhere in the
contribution chain (verified by grep: no `parseFloat`/`Number(amount)` in
any service, domain, action, or UI file).

- **Exact amount only.** `amountMatchesObligation` requires exact Decimal
  equality; no partial payment, no overpayment is accepted at confirmation.
  `recordContribution` enforces the same equality at insert time.
- **RECORDED is not collected money.** Never counted in `confirmedAmount`
  by either read model.
- **REJECTED is not collected money.** Excluded from `confirmedAmount` by
  the `WHERE status = 'CONFIRMED'` filter itself.
- **CONFIRMED is collected money**, and — because the partial unique index
  permits at most one `CONFIRMED` row ever per obligation — `confirmedAmount`
  in practice equals exactly `0` or exactly `expectedAmount`.
- **Fulfillment** (`isObligationFulfilled`) is ledger-derived
  (`confirmedAmount >= expectedAmount`), used by the member dashboard as its
  sole source of "fulfilled". The owner read model deliberately does **not**
  merge this into a boolean: it returns the persisted `obligation.status`
  and the ledger-derived `confirmedAmount`/`outstandingAmount` side by side
  (`contribution-owner-read.service.ts`'s own doc comment), so the two
  facts — which should always agree now that confirmation atomically writes
  `FULFILLED` — remain independently inspectable rather than silently
  merged. This is a deliberate design choice, not an inconsistency; both
  consumers use the identical shared helpers, so no arithmetic diverges
  between the owner desk and the member dashboard.
- **No round-status-derived accounting anywhere**: round eligibility for
  recording depends only on `circle.status === "ACTIVE"` (7J.1 decision #1);
  due dates neither authorize nor prohibit recording.
- **No UI-derived accounting**: every amount rendered in the owner desk
  (`contribution-desk-display.ts`) is formatted from an already-computed
  Decimal-derived string; nothing is recalculated in React.

## 5. Authorization boundaries

Every mutation (`recordContribution`/`confirmContribution`/`rejectContribution`)
independently, on every call:
1. `requireUser()` at the Server Action boundary (never trusted from the
   page).
2. `ownerId` from that call only — never from form/client data.
3. Circle ownership re-checked from a fresh DB read, twice (once unlocked
   for fail-fast, once again inside the row-locked transaction for any
   genuinely new write).
4. Every obligation/payment lookup is scoped by `(id, circleId)` —
   structurally impossible to resolve to another circle's row, via compound
   FKs (`[obligationId, circleId] -> [id, circleId]`, etc.), not just an
   application-level check.
5. Not-found and wrong-owner collapse to the identical outward error at
   every layer (service, action, and page) — a caller can never
   distinguish "doesn't exist" from "belongs to someone else."

Member-session identity (`requireCircleMember`, `nia_member_session`, the
member-auth system) appears nowhere in the recording/confirmation/rejection
services, actions, or owner desk UI — verified by grep across all of them
and by an explicit test in every one of those files' own test suites.

**Owner reads never expose:** PIN, `pinHash`, `failedPinAttempts`,
`credentialVersion`, sessions, token hashes, rate-limit data, or raw
platform `User` objects (`contribution-owner-read.service.test.ts`: "no PIN
hash, credential, or session field is ever exposed"; the owner desk UI
tests assert the same for rendered output). Raw actor IDs
(`recordedById`/`confirmedById`/`rejectedById`) are present in the read
model's typed result (needed for potential future use) but are **never
rendered** in the owner desk UI — verified by structural test.

**Member-facing reads remain scoped exactly as before**: the owner-read
repository (`contribution-owner-read.repository.ts`) is a separate,
parallel repository, not a widened version of
`circle-member-dashboard.repository.ts` — confirmed by an explicit test
("the owner-read repository does not widen circle-member-dashboard
.repository.ts's member-facing selects") and by inspection: no member-facing
route or component imports anything from the owner contribution read model
or services.

## 6. Replay / idempotency rules

| Case | Rule | Evidence |
|---|---|---|
| Same `clientOperationId`, same obligation+amount | Safe replay, returns existing payment's **current** status (may be `RECORDED`/`CONFIRMED`/`REJECTED`) | `contribution-recording.service.test.ts`: "replaying a since-CONFIRMED/-REJECTED payment's operation succeeds and reports its true current status" |
| Same `clientOperationId`, different obligation/amount | `ContributionOperationConflictError` — never silently treated as the same operation | "reusing an operation id with a different obligation/amount is a conflict" |
| Record replay after circle no longer ACTIVE | Still succeeds (resolved before the ACTIVE check, without the lock) | "a replay of an already-REJECTED operation succeeds even though the circle is no longer ACTIVE" |
| Duplicate confirm on already-CONFIRMED payment | Zero-write replay, no new timestamp | "replay writes no new timestamps -- confirmedAt is identical across replays" |
| Inconsistent CONFIRMED history (amount/currency drift, missing obligation FULFILLED) | Thrown as `ContributionConfirmationIntegrityConflictError` — **never auto-healed** | "a persisted amount/currency mismatch fails safely as an integrity error, without changing either row" |
| Duplicate reject, same reason | Zero-write exact-intent replay, no new timestamp | "replay writes no new timestamps -- rejectedAt is identical across replays" |
| Duplicate reject, different reason | `ContributionRejectionIntentConflictError` — never silently overwrites the original reason | "replaying rejection with a DIFFERENT reason is an intent conflict" |
| Old rejection replayed after a later payment fulfills the same obligation | Still succeeds — replay validity is judged on the payment row's own consistency, never the obligation's current status | 7J.4.1 fix + regression test (see §3) |

No replay path anywhere regenerates a provenance timestamp — verified by
dedicated tests in both the confirmation and rejection suites asserting
the identical `confirmedAt`/`rejectedAt` value across two calls.

## 7. Concurrency model

**Shared serialization primitive:** every mutating transaction begins by
taking `lockSavingsCircleForUpdate` (`SELECT ... FOR UPDATE` on
`SavingsCircle`) before touching any obligation/payment row — the same
lock every other circle-scoped mutation in this codebase already uses.
Payment-level races within one locked transaction are additionally guarded
by conditional updates (`UPDATE ... WHERE status = 'RECORDED'`), never a
read-then-write.

Verified with **real, database-backed concurrency tests** (`Promise.allSettled`
against the actual configured Postgres instance, not mocks):

| Race | Test | Result |
|---|---|---|
| Concurrent duplicate recording (same op id) | `contribution-recording.service.test.ts` | exactly one payment row |
| Competing recording ops on one obligation | same file | exactly one winner, one `ContributionObligationAlreadyRecordedError` |
| Concurrent confirmation | `contribution-confirmation.service.test.ts` | exactly one write, both calls resolve safely |
| Concurrent rejection | `contribution-rejection.service.test.ts` | exactly one write, both calls resolve safely |
| Confirm vs. reject | `contribution-rejection.service.test.ts`: "real confirm-vs-reject race" | exactly one terminal outcome, never mixed provenance |
| Record vs. confirm | `contribution-confirmation.service.test.ts`: "a real race: confirming a payment while a competing fresh recording attempt targets the same obligation" | serialized correctly |

**No writer bypasses the shared lock.** A repository-level grep across the
codebase confirms the only writers of `ContributionPayment`/
`ContributionObligation` are: `contribution-recording.repository.ts`
(create), `contribution-confirmation.repository.ts` (two conditional
updates, same transaction), `contribution-rejection.repository.ts` (one
conditional update), and `circle.repository.ts`'s `createMany` at
activation (the pre-existing, already-audited, out-of-scope obligation
seeding writer). No fifth writer exists.

## 8. Owner/member read boundaries

- **Owner** (`getOwnerCircleContributions`): full cross-member visibility
  for their own ACTIVE circle only — member identity, expected/confirmed/
  outstanding amounts, and the complete payment ledger including rejected
  history. Requires `requireUser()` + fresh ownership check.
- **Member** (`getCircleMemberDashboard`): scoped to exactly one
  `(circleId, memberId)` pair, no other member's identity or amounts, no
  payment-level history (only the derived summary). Untouched by the
  contribution-owner work — no shared repository, no widened select.

## 9. Explicit non-goals (V1)

Real money movement, a payment gateway, member self-recording, automatic
collection, automatic penalties/interest, loans, refunds, complex
reconciliation, financial analytics, notifications, a
correction/reversal workflow, round lifecycle (open/close), payout
recording, circle completion/archive, and any schema expansion. NIA
tracks the circle; it never holds or moves money — this is stated directly
in the owner desk's own copy.

## 10. Deferred issues (P2/P3 — not fixed in this ticket)

- **P3 — Round filter/navigation.** The owner desk renders all rounds
  grouped, with no per-round filter UI. Deferred in 7J.7 as explicitly
  non-blocking (all-rounds view is clear and mobile-usable); the read
  model already supports an optional `roundId` narrowing if ever needed.
- **P3 — No browser E2E coverage.** See §11.
- **P3 — `recordedById`/`confirmedById`/`rejectedById` remain in the typed
  read-model result** even though the current UI never renders them. Not a
  leak (nothing renders them, and they're already owner-scoped, non-PII
  platform-User IDs), but worth remembering if a future UI change touches
  that object shape.

No P0 or P1 issues were found. See §12.

## 11. Test-quality assessment

- **Pure tests** (no I/O): `contribution-accounting.test.ts`,
  `contribution-state.test.ts`, `contribution.schema.test.ts`,
  `contribution-desk-display.test.ts`. Fast, deterministic, exhaustive over
  the domain contract.
- **Mock/structural tests**: all three action test files
  (`record-contribution.test.ts`, `confirm-contribution.test.ts`,
  `reject-contribution.test.ts`) use dependency-injected fakes, not a real
  DB — they verify trust-boundary/error-mapping behavior, not persistence.
  All UI component tests (`record-contribution-form.test.ts`,
  `contribution-payment-controls.test.ts`, `contribution-desk.test.ts`,
  `page.test.ts`) are regex-based structural checks against source text —
  no DOM is rendered, no React reconciliation is exercised (this project
  has no jsdom/testing-library dependency; every UI ticket in this sequence
  uses this same methodology).
- **Live-fixture tests** (real Postgres, real rows, real cleanup):
  `contribution-recording.service.test.ts`,
  `contribution-confirmation.service.test.ts`,
  `contribution-rejection.service.test.ts`,
  `contribution-owner-read.service.test.ts` — the bulk of the domain
  correctness evidence.
- **Real concurrency tests**: the six races in §7, all against the live
  database via `Promise.allSettled`, not simulated.
- **Browser E2E: none exists, and none is claimed.** No component test
  actually mounts a form, types into a field, or clicks a button in a
  browser or jsdom environment. The `clientOperationId` stability behavior,
  the confirm/reject button wiring, and the record form's amount-display
  behavior are verified only by asserting the expected source patterns
  exist (e.g., that `onInput` calls `handleFormInput`, that the hidden
  `amount` input is `readOnly` and bound to the `amount` prop) — never by
  actually exercising the component. This is a genuine, explicit gap in
  independent coverage for the UI layer specifically; the financial
  correctness underneath it (services, repositories, concurrency) has real
  test coverage, but a regression that broke only the wiring between a
  button's `onClick` and its intended effect, while leaving the source
  text's shape intact, would not be caught by this suite.
- **Known pre-existing timing-sensitive test, unrelated to contribution
  work:** `circle-member-auth-rate-limit-cleanup.service.test.ts`'s
  "expiry is evaluated against PostgreSQL's own clock" sleeps 2 seconds
  past a 1-second-future expiry and is the one test in this codebase most
  architecturally prone to occasional timing flake under system load. Two
  full clean `pnpm test` runs during this audit (638 tests each) reproduced
  no failure; a single flake observed during an earlier ticket's session
  was not captured with enough detail to attribute definitively, but
  nothing in the contribution suite depends on wall-clock sleeps or
  external timing — every contribution concurrency test's correctness
  claim rests on `Promise.allSettled` outcomes and final DB state, not on
  elapsed time. This flake, if it recurs, should be attributed to the
  rate-limit cleanup timing test, not to contribution work.

## 12. Audit result — no P0/P1 found

No product code was changed by this audit. Findings by severity:

- **P0:** none.
- **P1:** none.
- **P2:** none identified beyond what's already listed as P3 below (all
  deferred items assessed as safe to defer, not correctness blockers).
- **P3:** round filter/navigation (deferred from 7J.7), no browser E2E
  (documented limitation, not a defect), unused actor-ID fields in the
  owner read-model type (no leak, just unused surface).

## 13. Freeze decision

**READY TO FREEZE.** The contribution workflow — record, confirm, reject,
owner desk UI, and the full audit chain from schema through UI — is
internally consistent, has no untested writer, no privacy leak, no
floating-point arithmetic, no accounting divergence between the owner and
member read models, and a verified (not assumed) concurrency model against
a real database for every race the ticket named. Payout/round-lifecycle
work may proceed on top of this contract without first resolving any
outstanding contribution-workflow defect.
