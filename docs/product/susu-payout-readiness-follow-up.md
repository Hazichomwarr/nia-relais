# SUSU payout-readiness adversarial audit (7M.3)

Status: audit-only. This records the manual observation that an owner could
record a payout before every required contribution appeared received or
confirmed. No runtime behavior, schema, migration, test, or financial history
changed.

## Finding and recommendation

**Finding: EXPECTED-BUT-SURPRISING.** The observation is correct under the
frozen Phase 7 contract. It is neither an authorization defect nor an
accounting-integrity defect.

**Recommendation: KEEP OPTION A.** While a circle is `ACTIVE`, its owner may
record the historical fact that an external payout occurred for any persisted
round. NIA must not mistake that record for a financially complete round:
advancement requires every contribution fulfilled from confirmed-payment
ledger sums and a payout confirmed by its persisted recipient.

The presentation follow-up is explanatory, not a P1 contract amendment. Do
not hide a truthful recording action solely because contributions are
incomplete. Explain that an early external payout may be recorded, but the
round remains financially incomplete and cannot close until all required
contributions and recipient confirmation are complete.

## What “contributions received” means

| Persisted/read-model fact | Meaning | Fresh `recordPayout` | Fresh `confirmPayout` / `disputePayout` | `advanceRound` / close | `completeCircle` |
| --- | --- | --- | --- | --- | --- |
| Obligation exists | Activation created the frozen member/round amount and currency owed. | Indirectly required: its set determines the authoritative payout amount and must be nonempty/currency-consistent. | Indirectly: payout must still match the frozen obligation sum. | Required; empty is integrity failure. | Required through every closed round. |
| Payment `RECORDED` | Owner entered an external contribution attempt. | Not required. | Not required. | Insufficient. | Insufficient. |
| Payment `CONFIRMED` | Responsible member accepted the recorded payment. | Not required. | Not required. | Its amount counts in the confirmed ledger. | Indirectly. |
| Obligation `FULFILLED` | Confirmed total reaches frozen expected amount, consistent with persisted status/provenance. | Not required. | Not required. | Required for every obligation. | Indirectly. |
| Rejected payment history | Historical rejected attempt; contributes zero to confirmed sums. | Not required. | Not required. | Does not block except through remaining outstanding amount. | Indirectly. |
| Outstanding amount | `expectedAmount - confirmed-payment sum`; positive is incomplete accounting. | Not required. | Not required. | Must be zero for every obligation. | Indirectly. |

`completeCircle` requires every round already `CLOSED`; the frozen closure
rule enforces fulfilled contributions plus a confirmed, correct payout. A
`RECORDED` payout never means settlement readiness.

## Frozen 7K evidence

`docs/product/susu-payout-workflow-audit.md`, **V1 Signed-Off Contract —
7K.1, item 3**, explicitly and bindingly permits an owner to record a payout
for **any persisted round** while `SavingsCircle.status` is `ACTIVE`. It must
not require the round to be `ACTIVE`, its due date to have arrived, its
obligations to be `FULFILLED`, contributions to be confirmed, or prior
recipient action.

The rationale is equally binding: `recordPayout` records an external fact;
NIA neither authorizes nor executes the transfer. Refusing a true early event
would make the ledger less truthful without preventing the real-world payout.
Items 8–9 separately freeze `PayoutRound.status` (`UPCOMING → ACTIVE →
CLOSED`) as workflow/presentation—not financial mutation authority. Financial
readiness belongs to closure: every obligation fulfilled and payout confirmed.

## Actual `recordPayout` path and predicates

Path: `PayoutDesk` / `RecordPayoutForm` → `recordPayoutAction` →
`runRecordPayoutAction` (trusted `requireUser()` owner context and input
validation) → `recordPayout` → `payout-recording.repository.ts` → `Payout`
insert.

Fresh recording verifies the following, with authoritative checks repeated
under `lockSavingsCircleForUpdate`:

| Predicate | Result | Authority |
| --- | --- | --- |
| Trusted owner and fresh ownership | Required | Action boundary plus `SavingsCircle.ownerId`, re-read under lock. |
| Circle is `ACTIVE` | Required for a new row | Exact replay is intentionally resolved first. |
| Persisted same-circle round | Required | `(id, circleId)`-scoped lookup. |
| Exact amount/currency | Required | Sum of frozen `ContributionObligation.expectedAmount`; nonempty and one-currency integrity checks. |
| One permanent payout per round | Required | Preflight plus full `@@unique([roundId])` backstop. |
| Operation replay integrity | Required | `(circleId, clientOperationId)`, same round/amount intent, revalidated history. |
| Round is `ACTIVE` | Intentionally absent | Frozen 7K.1 items 3 and 8. |
| Contributions ready / obligations `FULFILLED` | Intentionally absent | Frozen 7K.1 item 3. |
| Confirmed contribution ledger sums | Intentionally absent | Closure authority, not recording authority. |
| Due date reached | Intentionally absent | Frozen 7K.1 item 3. |

This is not accidental: the repository deliberately reads neither round status
nor due date, and the fixture suite explicitly proves recording works for
`UPCOMING`, `ACTIVE`, and `CLOSED` rounds and for past/future due dates.

## Canonical contribution-readiness authority

`assessContributionClosureReadiness` in `src/domain/round-lifecycle.ts` is
the canonical predicate used by `advanceRound` and the owner lifecycle read
model. It evaluates every persisted obligation and confirmed-payment ledger
sum. `READY` requires every obligation to have a confirmed total exactly
fulfilling its frozen expected amount, `status === FULFILLED` consistent with
that ledger, and coherent `fulfilledAt` provenance. Empty obligations or a
ledger/status disagreement are integrity errors—not ordinary waiting states.

The predicate could technically support a future strict payout gate because it
is pure, based on frozen history, and used under the shared circle lock. Doing
so would be a deliberate amendment to 7K.1, not a defect repair.

## UI/read-model audit

The Payouts desk renders a fresh recording form for every unrecorded persisted
round in an active circle. Its helper checks only whether a `Payout` row
exists; it deliberately ignores round status, due date, and contribution
readiness. Thus it offers a control for the current round, future `UPCOMING`
rounds, and a `CLOSED` round with no payout (unusual but contractually
eligible while the circle remains active).

The Overview uses the lifecycle read model and can show **“Waiting for
contributions”** for a current round with `CONTRIBUTIONS_INCOMPLETE`, then
link to a Payouts page that permits recording a real external payout. This is
a presentation ambiguity, not contradictory domain behavior:

- “Waiting for contributions” means not ready to close/advance.
- “Record payout” means record the event only if it really happened.

It becomes a contradiction only if copy says “all members must contribute
before a payout can be made.” That is false under the frozen contract. A
future presentation-only refinement can state, for example: “2 of 3
contributions confirmed — this round cannot close yet.”

## Future-round behavior

| Round status | Fresh payout recording | Why |
| --- | --- | --- |
| `ACTIVE` | Allowed | Current-round bookkeeping; still independent of contribution readiness. |
| `UPCOMING` | Allowed | 7K.1 separates orientation from historical financial recording; participants may act early. |
| `CLOSED` | Allowed if no payout exists | Status is non-authorizing; a correctly closed round normally already has its confirmed payout occupying the unique slot. |
| Any persisted same-circle round | Allowed | Subject to owner, active-circle, frozen amount, uniqueness, and replay/integrity checks. |

Fresh recording is blocked once the circle is no longer `ACTIVE`; exact
historical replay remains resolvable before that fresh-state gate.

## Product decision: Option A versus Option B

### Option A — current, frozen contract

Record an external payout at any time while the circle is active. This is
faithful to real-world activity and NIA’s non-custodial role. It does not claim
the round is coherent: contribution readiness, recipient confirmation, and
closure remain distinct safeguards. Its cost is clear explanatory copy.

### Option B — strict workflow gate

Allow a new payout only for the current `ACTIVE` round after
`assessContributionClosureReadiness` returns `READY`, while preserving exact
historical replay. This makes the workflow simpler but rejects recording a
true early external transfer. It prioritizes in-app sequence over a truthful
historical ledger without preventing the real-world action.

**Decision: keep Option A.** In the central reality-vs-workflow choice, NIA
should allow a true early event to be recorded but clearly mark the round
financially incomplete and unable to close. That protects historical truth
and retains the hard settlement boundary.

## Authorization and accounting safety

This is not loose authority:

- only the authenticated platform owner may freshly record, with ownership
  re-read under the circle lock;
- only persisted `PayoutRound.recipientId`, derived through the member session
  boundary, may confirm or dispute;
- another member is unauthorized; a foreign/nonexistent resource is safely
  non-enumerable; and
- another platform user cannot record for a circle they do not own.

Early recording writes one immutable, exact-amount `RECORDED` payout and does
not mutate rounds, obligations, payments, or circle lifecycle. Later
contribution confirmation can fulfill obligations; recipient confirmation can
make the payout ready; a recipient dispute is terminal. Until both predicates
are satisfied, `advanceRound` fails safely. A disputed payout cannot close a
round, and `completeCircle` requires every round closed.

The behavior is **allowed but surprising**, not unsafe. `RECORDED` means “the
owner reports an external payout,” never “contributions settled,” “recipient
confirmed,” or “round closed.”

## Replay, concurrency, and amendment impact

No contract change is recommended. If a future strict gate were adopted, it
must preserve existing ordering: resolve exact idempotent replay first, then
apply the fresh-recording gate. Otherwise a legitimate replay could fail after
the circle becomes `COMPLETED` or `ARCHIVED`.

All financial writers share `lockSavingsCircleForUpdate`. Under a hypothetical
Option B, a last-contribution-confirmation vs. record-payout race serializes:
if confirmation commits first, recording sees `READY`; if recording locks
first, it finds incomplete accounting and safely writes nothing. Under Option
A, no readiness race exists; later advancement re-reads the complete ledger
and payout state under the same lock.

If product ownership later chooses Option B, the amendment must explicitly
cover the 7K.1 service contract and implementation, recording tests (including
the intentionally all-round-status/due-date cases), owner payout CTA,
Overview wording, and Phase 7 freeze documentation. Lifecycle/completion
documentation would only clarify the earlier gate; their closure predicates
must not be weakened or duplicated. No schema migration is required.

## Scope and blockers

Only this documentation file changed. No code, schema, migration, test, data,
or product behavior changed. There are no blockers to the current V1
contract. The only non-blocking follow-up is presentation clarification so
closure readiness is not read as a prohibition on recording a real external
payout.
