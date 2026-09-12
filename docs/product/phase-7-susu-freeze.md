# Phase 7 — SUSU Circles: Freeze Document

Status: **FROZEN.** This is the final, phase-boundary freeze for the entire
V1 SUSU circle feature — draft creation through explicit circle completion.
It is a summary document: detailed contracts already live in
`docs/product/susu-contribution-workflow-audit.md`,
`docs/product/phase-7j-contribution-workflow-freeze.md`,
`docs/product/susu-payout-workflow-audit.md` (which also contains the
frozen round-lifecycle contract, §21), `docs/product/susu-circle
-completion-audit.md`, and the four `docs/security/*.md` member-auth
contracts. This document does not duplicate them — it summarizes and
cross-references, and records the one final freeze decision that sits
above all of them.

Audited by 7M against the code as it exists after 7L.4. No product code
was changed by 7M — no P0/P1 defect was found requiring one.

## 1. V1 product contract, one sentence per slice

A SUSU circle is created `DRAFT` by its owner, who adds members and sets
a payout order; the owner explicitly activates it, which freezes the
cohort/terms and generates the full rotation (`PayoutRound` +
`ContributionObligation`, N rounds for N members); the owner then
explicitly starts and advances rounds one at a time, each requiring every
member's contribution confirmed and that round's payout recorded and
confirmed by its own recipient before it may close; once every round has
closed, the owner may explicitly mark the circle `COMPLETED`, which
freezes it as a permanent historical record still readable by the owner
and every member. `ARCHIVED` exists in the schema but is not yet
reachable by any writer — fully deferred.

## 2. Persistence model

`SavingsCircle` (`status: DRAFT→ACTIVE→COMPLETED`, `activatedAt`/
`activatedById`, `completedAt`/`completedById`, `archivedAt`/
`archivedById` unused), `CircleMember` (identity + `payoutOrder`, frozen
at activation), `PayoutRound` (one per member, `recipientId` frozen,
`status: UPCOMING→ACTIVE→CLOSED`), `ContributionObligation` (one per
round×member, `expectedAmount`/`currency`/`dueDate` frozen at
activation), `ContributionPayment` (append-only ledger,
`RECORDED→CONFIRMED` or `RECORDED→REJECTED`), `Payout` (one per round,
`RECORDED→CONFIRMED` or `RECORDED→DISPUTED`), `CircleMemberSession`
(opaque token hash, revocation by row), `CircleMemberAuthRateLimitBucket`
(HMAC-keyed source/target/global counters). Re-verified this ticket:
exactly 3 `SavingsCircle` writers exist codebase-wide
(`createDraftCircleRecord`/`markCircleActive`/`completeActiveCircle`);
every historical FK is `onDelete: Restrict`; `Payout.@@unique([roundId])`
and `PayoutRound.@@unique([circleId, roundNumber])`/`[circleId,
recipientId]` remain the structural backbone every service reuses rather
than re-deriving. **No field is semantically contradictory; no migration
is needed.**

## 3. Circle lifecycle (final V1 shape)

```
DRAFT --activateCircle--> ACTIVE --completeCircle--> COMPLETED
```

No implemented path permits `ACTIVE → DRAFT`, `COMPLETED → ACTIVE`,
`COMPLETED → CANCELLED`, member replacement/reordering/financial-term
mutation after activation, reopening a `CLOSED` round, or reopening a
`COMPLETED` circle — confirmed by grep (single writer per transition,
each a compare-and-swap guarded by the exact prior status) and by the
live-DB test suites for each slice. Legacy `CANCELLED` remains a dead
enum value with zero writers.

## 4. Actor/authorization model

Two entirely separate identity systems, confirmed to share no code path:
platform `User` (Auth.js, `requireUser()`) for the owner, and
`CircleMember` (code + PIN, `requireCircleMember()`,
`nia_member_session` cookie) for members. Full matrix:

| Operation | Owner User | Recipient Member | Other Member | Other User |
|---|---|---|---|---|
| Create circle / add-remove draft member / set payout order / activate | ✅ (own circle, `DRAFT` only) | ❌ | ❌ | ❌ |
| Read owner workspace (any state) | ✅ (own circle only) | ❌ | ❌ | ❌ |
| Read member workspace | ❌ (no owner route reads via member session) | ✅ (own dashboard/payout only) | ❌ (no cross-member read) | ❌ |
| Record contribution / record payout | ✅ (own circle, `ACTIVE` only) | ❌ | ❌ | ❌ |
| Confirm/reject contribution | ✅ (own circle, `ACTIVE` only) | ❌ (never — owner-only decision) | ❌ | ❌ |
| Confirm/dispute payout | ❌ (owner has no authority here) | ✅ (own round's payout only) | ❌ | ❌ |
| Start/advance round | ✅ (own circle, `ACTIVE` only) | ❌ | ❌ | ❌ |
| Complete circle | ✅ (own circle, `ACTIVE`+all-closed only) | ❌ | ❌ | ❌ |

Every mutation derives its actor exclusively from the trusted session at
the action/route boundary (`requireUser()`/`requireCircleMember()`),
never from `FormData`/request body — re-verified by structural tests in
every action/service test file across all of 7I–7L.4.

## 5. Contribution contract (frozen 7J, unchanged)

See `phase-7j-contribution-workflow-freeze.md` in full. Summary:
`(none)→RECORDED→CONFIRMED|REJECTED`, exact-Decimal amount only, no
reversal/edit/delete, `ContributionPayment` ledger authoritative over
`ContributionObligation.status`, exact-intent and terminal-decision
replay both survive `COMPLETED` unmodified, fresh mutation gated by
`circle.status === "ACTIVE"` only. Re-verified this phase: byte-unchanged
since 7J; only the READ side (`contribution-owner-read.service.ts`) was
touched, in 7L.3, to extend historical-read eligibility to `COMPLETED`.

## 6. Payout contract (frozen 7K, unchanged)

`(none)→RECORDED→CONFIRMED` or `RECORDED→DISPUTED`, terminal thereafter.
Expected amount always recomputed from frozen obligations
(`computeExpectedPayoutAmount`), one `Payout` per round
(`@@unique([roundId])`), only the round's own persisted `recipientId`
may confirm/dispute, disputes permanently block that round's
progression, no correction/replacement/reversal. `getOwnerCirclePayouts`
has been `ACTIVE`/`COMPLETED`/`ARCHIVED`-eligible since 7K.7, unchanged.

## 7. Round-lifecycle contract (frozen 7K.11–7K.16, unchanged)

`UPCOMING→ACTIVE→CLOSED`, at most one `ACTIVE` round, explicit
owner-only `activateFirstRound`/`advanceRound`, non-final close +
successor activation atomic (one timestamp, one transaction), financial
closure predicates re-derived (never trusted from a bare status) at
close time, no due-date/current-date gating anywhere. **Final round
closure does not complete the circle** — that remains 7L's own separate,
explicit act. `getOwnerRoundLifecycle` remains `ACTIVE`-only by design
(7L.3 §6, re-confirmed 7L.4) — a completed circle has no lifecycle
transition left to display.

## 8. Completion contract (frozen 7L, implemented 7L.1–7L.3, audited 7L.4)

`ACTIVE` + structurally coherent full rotation + every round `CLOSED` +
fresh financial revalidation (Option B, defense-in-depth) → explicit
owner `completeCircle` → `COMPLETED`. No automatic completion, no
archive, same-owner-only replay, one CAS write, no round/financial
provenance rewritten. See `susu-circle-completion-audit.md` §1–38 for
the full contract and every implementation/audit detail; 7L.4's own
audit re-confirmed zero code drift since that ticket, and 7M's audit
re-confirms it again — **no completion-domain code has changed since
7L.4's own full-suite verification.**

## 9. Historical-access rules

| Reader | DRAFT | ACTIVE | COMPLETED |
|---|---|---|---|
| Owner workspace | setup controls | operational controls | historical, read-only |
| Owner contribution history | — | ✅ | ✅ (7L.3 fix) |
| Owner payout history | — | ✅ | ✅ (since 7K.7) |
| Member dashboard/payout | — | ✅ | ✅ (since 7G/7H) |

The one P1 this entire phase carried (the owner route 404ing on
`COMPLETED`) was fixed by 7L.3 and re-confirmed fixed by both 7L.4 and
this ticket.

## 10. Idempotency / replay policy (compact matrix)

| Operation | Classification |
|---|---|
| Create/add/remove/reorder/activate draft circle | Natural state replay (activation re-validates immutable structure; add/remove are DRAFT-gated CAS writes) |
| Record contribution / record payout | `clientOperationId` idempotency (exact-intent replay, resolved before any lock or ACTIVE check) |
| Confirm/reject contribution, confirm/dispute payout | Terminal exact-intent replay (same decision replays as a zero-write success; a different decision on an already-terminal row is a conflict, not silently accepted) |
| Start first round / advance round | Natural state replay (an already-`ACTIVE`/`CLOSED` round resolves as replay, never re-transitioned) |
| Complete circle | Natural state replay, same-owner-only (frozen 7L §9) |

All replay paths are coherent across every terminal circle state this
phase defines — none regenerates a provenance timestamp (verified by
dedicated tests in every slice).

## 11. Concurrency model

One shared primitive throughout: `lockSavingsCircleForUpdate` (`SELECT
... FOR UPDATE` on `SavingsCircle`), acquired first, before any
circle-scoped read or write, in every mutating service across every
slice (activation, contribution, payout, round lifecycle, completion).
No lock-order inversion exists anywhere — re-confirmed by grep across
every repository file: no writer acquires a second table's lock before
`SavingsCircle`'s own. Every real-DB concurrency race named across 7J
(6 races), 7K (round lifecycle + payout), and 7L.1 (2 races) has live,
non-mocked `Promise.allSettled`-against-Postgres evidence; re-verified
in this audit that none use a mocked clock, mocked Promise, or fabricated
race.

## 12. Major test evidence

7L.4 performed the phase's own strategic full-suite run (re-referenced,
not re-run by this ticket per its own explicit instruction):

```
1407 total / 1399 passed / 1 failed / 7 skipped
```

The one failure (`circle-member-auth-rate-limit.service.test.ts`) is
confirmed, by repeated isolated re-runs across both 7L.1 and 7L.4, to be
intermittent under genuine concurrent load against this environment's
shared, non-isolated dev database — unrelated to circle completion or
any other SUSU domain code (zero references either direction). No
completion-domain, contribution-domain, payout-domain, or round
-lifecycle-domain test has ever failed or flaked across dozens of runs
in this entire phase. The 7 skipped tests are the documented,
`TEST_DATABASE_URL`-gated destructive rate-limit cleanup tests.

## 13. Known deferrals (Phase 8 / post-V1)

| Item | Classification |
|---|---|
| Archive (`archiveCircle`, archive UI, `COMPLETED → ARCHIVED`) | Phase 8 desirable — schema-ready, zero implementation, safely deferrable |
| Manual authenticated browser E2E for the completion flow | Phase 8 desirable (release-hardening) — not a freeze blocker |
| Real Vercel source-IP spoofing test (trusted-member-auth-source contract §10 item 4) | Phase 8 desirable — requires a real Vercel deployment to test against, cannot be verified locally |
| Isolated `TEST_DATABASE_URL` for destructive rate-limit cleanup tests | Phase 8 desirable (test-infrastructure hardening) |
| `circle-member-auth-rate-limit.service.test.ts` intermittent flakiness | Phase 8 desirable (test-infrastructure hardening) — not a product defect |
| 9 pre-existing `tsc` test-file errors (`NODE_ENV`/import-extension) | Phase 8 desirable (lint/tooling cleanup) — non-blocking, unrelated to runtime behavior |
| Notifications | Post-V1 — no product requirement named it for V1 |
| PIN rotation / member recovery-reset flows | Post-V1 — not named as a V1 requirement anywhere in 7G–7L |
| A richer owner "my circles" index/list/navigation page | Post-V1 — no such page exists at all yet; nothing to filter or improve until one is built |

None of these is a Phase 8 *release blocker* — each was independently
assessed by its own ticket (7G.2.4/7L.3/7L.4) as safely deferrable, and
this audit found no new evidence raising any of their severity.

## 14. P0/P1 status

**P0: none, phase-wide.** **P1: none unresolved, phase-wide** — the one
P1 this phase ever carried (owner-route 404 on `COMPLETED`) is fixed.

## 15. Freeze decision

**Phase 7 (SUSU circles, V1) is FROZEN.**

No P0. No unresolved P1. No cross-slice authorization contradiction (one
matrix, §4, holds throughout). No financial-accounting contradiction (7J
and 7K contracts independently frozen and re-confirmed intact). No
lifecycle contradiction (§3's transition diagram is exhaustive and
enforced by CAS writes, not convention). Owner/member privacy boundaries
hold (re-verified: no `pinHash`/session token/other-member financial row
ever leaks through any read model). Terminal historical states remain
fully accessible to both owner and member. The one known test flake is
demonstrably unrelated to any SUSU domain code. Every remaining open
item is legitimately Phase 8 or post-V1, per this document's own
explicit standard.

Phase 8 may begin. Recommended first boundary: **archive
(`COMPLETED → ARCHIVED`)**, since it is the smallest, most-requested,
schema-ready remaining SUSU lifecycle gap, followed by the outstanding
manual browser smoke test as a release-hardening companion to whatever
ticket first ships a "Complete circle" button to real users.
