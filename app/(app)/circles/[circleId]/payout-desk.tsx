import type { OwnerCirclePayoutsResult, OwnerPayoutsRoundResult } from "@/src/services/payout-owner-read.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

import { formatContributionDateTime, formatContributionMoney } from "./contribution-desk-display";
import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";
import { canRecordFreshPayout, getPayoutStatusPresentation } from "./payout-desk-display";
import { RecordPayoutForm } from "./record-payout-form";

// Read-only orchestration of getOwnerCirclePayouts' own result (7K.7) --
// this component queries nothing itself (no Prisma, no duplicate
// financial read model, no obligation summing) and invents no
// eligibility rule beyond what payout-desk-display.ts already derives
// from persisted facts. The only mutation this file can ever trigger is
// recordPayoutAction (via RecordPayoutForm) -- there is no owner-facing
// confirm/dispute control anywhere here; only the recipient can confirm
// or dispute a payout (7K.1 sign-off item 4), and that UI does not exist
// yet (7K.10).
//
// readOnly (7L.3): an explicit mode, not an incidental consequence of
// persisted data shape -- see contribution-desk.tsx's own identical
// comment. getOwnerCirclePayouts was already COMPLETED-eligible before
// this ticket; what changes here is that the owner page now actually
// reaches this component for a COMPLETED circle, and must never let it
// render RecordPayoutForm regardless of what canRecordFreshPayout says.

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#e2d7c9] py-5 first:pt-0 last:border-b-0">
      <h2 className="font-serif text-2xl tracking-tight text-[#173b32]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function RoundCard({
  circleId,
  round,
  readOnly,
  dictionary,
}: {
  circleId: string;
  round: OwnerPayoutsRoundResult;
  readOnly: boolean;
  dictionary: Dictionary;
}) {
  const copy = dictionary.susuFinancial;
  const isImportedRound = round.closureBasis === "IMPORTED_DECLARATION";
  const roundStatus = getRoundStatusBadge(round.status, round.closureBasis);
  const presentation = getPayoutStatusPresentation(round.payout ? round.payout.status : null, round.payout?.confirmationBasis);
  const statusCopy = round.payout === null
    ? { label: copy.unrecorded, description: copy.payoutUnrecordedDescription }
    : round.payout.confirmationBasis === "IMPORTED_DECLARATION"
      ? { label: copy.importedHistory, description: copy.importedHistoryDescription }
      : round.payout.status === "RECORDED"
        ? { label: copy.payoutRecorded, description: copy.payoutRecordedDescription }
        : round.payout.status === "CONFIRMED"
          ? { label: copy.payoutConfirmed, description: copy.payoutConfirmedDescription }
          : { label: copy.disputed, description: copy.payoutDisputedDescription };
  const canRecord = !readOnly && canRecordFreshPayout(round.payout);

  return (
    <Card title={`${copy.round} ${round.roundNumber} · ${round.recipient.displayName}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          label={isImportedRound ? roundStatus.label : round.status === "ACTIVE" ? copy.active : round.status === "UPCOMING" ? copy.upcoming : round.status === "CLOSED" ? copy.closed : roundStatus.label}
          className={roundStatus.className}
        />
        <p className="text-xs text-[#7b8179]">{copy.due} {formatOwnerDate(round.dueDate)}</p>
      </div>
      <p className="mt-1 text-xs text-[#7b8179]">{round.recipient.memberCode}</p>
      {isImportedRound ? <p className="mt-1 text-xs leading-5 text-[#7b8179]">{copy.importedHistoryDescription}</p> : null}

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.expected} {copy.payout}</dt>
          <dd className="mt-1 text-[#173b32]">
            {formatContributionMoney(round.expectedPayout.amount, round.expectedPayout.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.status}</dt>
          <dd className="mt-1">
            <Badge label={statusCopy.label} className={presentation.className} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-5 text-[#7b8179]">{statusCopy.description}</p>

      {round.payout ? (
        <details className="mt-3 rounded-xl bg-[#f7f1e8] p-3 text-sm">
          <summary className="cursor-pointer text-sm font-semibold text-[#173b32]">{copy.payoutRecord}</summary>
          <div className="mt-3">
          <p className="font-semibold text-[#173b32]">
            {formatContributionMoney(round.payout.amount, round.payout.currency)}
          </p>
          <p className="mt-1 text-xs text-[#7b8179]">{copy.payoutRecorded} {formatContributionDateTime(round.payout.recordedAt)}</p>
          {round.payout.confirmedAt && round.payout.confirmationBasis === "IMPORTED_DECLARATION" ? (
            <p className="text-xs text-[#7b8179]">{copy.importedHistoryDescription}</p>
          ) : round.payout.confirmedAt ? (
            <p className="text-xs text-[#7b8179]">{copy.payoutConfirmed} {formatContributionDateTime(round.payout.confirmedAt)}</p>
          ) : null}
          {round.payout.disputedAt ? (
            <p className="text-xs text-[#7b8179]">{copy.disputed} {formatContributionDateTime(round.payout.disputedAt)}</p>
          ) : null}
          {round.payout.disputeReason ? (
            <p className="mt-1 text-xs leading-5 break-words text-[#8d4f42]">
              {copy.reason}: {round.payout.disputeReason}
            </p>
          ) : null}
          </div>
        </details>
      ) : null}

      {canRecord ? (
        <div className="mt-4">
          <RecordPayoutForm
            circleId={circleId}
            roundId={round.id}
            amount={round.expectedPayout.amount}
            currency={round.expectedPayout.currency}
            dictionary={dictionary}
          />
        </div>
      ) : null}
    </Card>
  );
}

export function PayoutDesk({
  circleId,
  payouts,
  readOnly,
  dictionary,
  locale: _locale,
}: {
  circleId: string;
  payouts: OwnerCirclePayoutsResult;
  readOnly: boolean;
  dictionary: Dictionary;
  locale: Locale;
}) {
  void _locale;
  const copy = dictionary.susuFinancial;
  const { rounds, summary } = payouts;

  return (
    <div className="w-full min-w-0 max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{dictionary.susu.eyebrow}</p>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-[#173b32] sm:text-4xl">{copy.payouts}</h1>
      <Card title={copy.payouts}>
        <p className="text-sm leading-6 text-[#587066]">
          {readOnly
            ? copy.completePayoutHistory
            : copy.payoutDescription}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.totalRounds}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.totalRounds}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.unrecorded}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.unrecordedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.payoutRecorded}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.recordedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.payoutConfirmed}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.confirmedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.disputed}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.disputedCount}</dd>
          </div>
        </dl>
      </Card>

      {rounds.length === 0 ? (
        <Card title={copy.round}>
          <p className="text-sm leading-6 text-[#587066]">{copy.noRounds}</p>
        </Card>
      ) : (
        rounds.map((round) => <RoundCard key={round.id} circleId={circleId} round={round} readOnly={readOnly} dictionary={dictionary} />)
      )}
    </div>
  );
}
