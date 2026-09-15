import type {
  OwnerCircleContributionsResult,
  OwnerContributionsObligationResult,
  OwnerContributionsPaymentResult,
} from "@/src/services/contribution-owner-read.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";
import {
  canRecordFreshContribution,
  formatContributionDateTime,
  formatContributionMoney,
  getObligationStatusPresentation,
  getPaymentStatusPresentation,
  groupObligationsByRoundId,
  groupPaymentsByObligationId,
  sortPaymentsNewestFirst,
} from "./contribution-desk-display";
import { ContributionPaymentControls } from "./contribution-payment-controls";
import { RecordContributionForm } from "./record-contribution-form";

// Read-only orchestration of getOwnerCircleContributions' own result (7J.5)
// -- this component queries nothing itself (no Prisma, no duplicate
// financial read model) and invents no eligibility rule beyond what
// contribution-desk-display.ts already derives from persisted facts. Every
// mutation is delegated to the three existing Server Actions
// (recordContributionAction/confirmContributionAction/rejectContributionAction)
// via their own small client components -- this file only decides WHICH of
// those to render, from the read model's own obligation/payment status.
//
// readOnly (7L.3): an explicit mode, not an incidental consequence of
// persisted data shape. getOwnerCircleContributions is now eligible for
// both ACTIVE and COMPLETED circles (the P1 fix); a COMPLETED circle's own
// obligations/payments would already happen to make
// canRecordFreshContribution false and every payment CONFIRMED (never
// RECORDED) by construction of the completion predicate itself -- but this
// component does not rely on that coincidence to decide whether to render
// a mutation control. The owner circle page passes readOnly explicitly,
// based on which branch (ACTIVE vs COMPLETED) it is rendering, and this
// component suppresses RecordContributionForm/ContributionPaymentControls
// unconditionally when it is true, regardless of what canRecordFreshContribution
// or payment.status say.

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

function PaymentHistoryItem({
  circleId,
  payment,
  readOnly,
  dictionary,
}: {
  circleId: string;
  payment: OwnerContributionsPaymentResult;
  readOnly: boolean;
  dictionary: Dictionary;
}) {
  const copy = dictionary.susuFinancial;
  const presentation = getPaymentStatusPresentation(payment.status);
  const statusCopy = payment.status === "RECORDED"
    ? { label: copy.recorded, description: copy.contributionRecordedDescription }
    : payment.status === "CONFIRMED"
      ? { label: copy.confirmed, description: copy.contributionConfirmedDescription }
      : payment.status === "REJECTED"
        ? { label: copy.rejected, description: copy.contributionRejectedDescription }
        : { label: payment.status, description: "" };

  return (
    <li className="rounded-lg bg-[#f7f1e8] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[#173b32]">{formatContributionMoney(payment.amount, payment.currency)}</span>
        <Badge label={statusCopy.label} className={presentation.className} />
      </div>
      <p className="mt-1 text-xs text-[#7b8179]">{statusCopy.description}</p>
      <p className="mt-1 text-xs text-[#7b8179]">{copy.recorded} {formatContributionDateTime(payment.recordedAt)}</p>
      {payment.confirmedAt ? (
        <p className="text-xs text-[#7b8179]">{copy.confirmed} {formatContributionDateTime(payment.confirmedAt)}</p>
      ) : null}
      {payment.rejectedAt ? (
        <p className="text-xs text-[#7b8179]">{copy.rejected} {formatContributionDateTime(payment.rejectedAt)}</p>
      ) : null}
      {payment.rejectionReason ? (
        <p className="mt-1 text-xs text-[#8d4f42]">{copy.reason}: {payment.rejectionReason}</p>
      ) : null}

      {!readOnly && payment.status === "RECORDED" ? (
        <div className="mt-3">
          <ContributionPaymentControls circleId={circleId} paymentId={payment.id} dictionary={dictionary} />
        </div>
      ) : null}
    </li>
  );
}

function ObligationCard({
  circleId,
  obligation,
  payments,
  readOnly,
  dictionary,
}: {
  circleId: string;
  obligation: OwnerContributionsObligationResult;
  payments: readonly OwnerContributionsPaymentResult[];
  readOnly: boolean;
  dictionary: Dictionary;
}) {
  const canRecord = !readOnly && canRecordFreshContribution(obligation, payments);
  const history = sortPaymentsNewestFirst(payments);
  const isImported = obligation.fulfillmentBasis === "IMPORTED_DECLARATION";
  const statusPresentation = getObligationStatusPresentation(obligation.status, obligation.fulfillmentBasis);
  const statusLabel = isImported
    ? dictionary.susuFinancial.importedHistory
    : obligation.status === "FULFILLED"
      ? dictionary.susuFinancial.fulfilled
      : obligation.status === "OPEN"
        ? dictionary.susuFinancial.open
        : obligation.status;

  return (
    <li className="border-b border-[#e7ded1] py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#173b32]">
          {obligation.memberDisplayName}
        </p>
        <Badge label={statusLabel} className={statusPresentation.className} />
      </div>
      <p className="mt-1 text-xs text-[#7b8179]">{obligation.memberCode}</p>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{dictionary.susuFinancial.expected}</dt>
          <dd className="mt-1 text-[#173b32]">{formatContributionMoney(obligation.expectedAmount, obligation.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{dictionary.susuFinancial.confirmed}</dt>
          <dd className="mt-1 text-[#173b32]">{formatContributionMoney(obligation.confirmedAmount, obligation.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{dictionary.susuFinancial.outstanding}</dt>
          <dd className="mt-1 text-[#173b32]">{formatContributionMoney(obligation.outstandingAmount, obligation.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{dictionary.susuFinancial.due}</dt>
          <dd className="mt-1 text-[#173b32]">{formatOwnerDate(obligation.dueDate)}</dd>
        </div>
      </dl>

      {canRecord ? (
        <div className="mt-4">
          <RecordContributionForm
            circleId={circleId}
            obligationId={obligation.id}
            amount={obligation.expectedAmount}
            currency={obligation.currency}
            dictionary={dictionary}
          />
        </div>
      ) : null}

      {isImported ? (
        <p className="mt-4 text-xs leading-5 text-[#7b8179]">{dictionary.susuFinancial.importedHistoryDescription}</p>
      ) : history.length > 0 ? (
        <details className="mt-4 rounded-xl bg-[#f7f1e8] px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[#587066]">{dictionary.susuFinancial.paymentHistory} ({history.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {history.map((payment) => (
              <PaymentHistoryItem key={payment.id} circleId={circleId} payment={payment} readOnly={readOnly} dictionary={dictionary} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export function ContributionDesk({
  circleId,
  contributions,
  readOnly,
  dictionary,
  locale: _locale,
}: {
  circleId: string;
  contributions: OwnerCircleContributionsResult;
  readOnly: boolean;
  dictionary: Dictionary;
  locale: Locale;
}) {
  void _locale;
  const copy = dictionary.susuFinancial;
  const { rounds, obligations, payments } = contributions;
  const obligationsByRoundId = groupObligationsByRoundId(obligations);
  const paymentsByObligationId = groupPaymentsByObligationId(payments);

  return (
    <div className="w-full min-w-0 max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{dictionary.susu.eyebrow}</p>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-[#173b32] sm:text-4xl">{copy.contributions}</h1>
      <Card title={copy.contributions}>
        <p className="text-sm leading-6 text-[#587066]">
          {readOnly
            ? copy.completeContributionHistory
            : copy.contributionDescription}
        </p>
      </Card>

      {rounds.length === 0 ? (
        <Card title={copy.rounds}>
          <p className="text-sm leading-6 text-[#587066]">{copy.noRounds}</p>
        </Card>
      ) : (
        rounds.map((round) => {
          const roundObligations = obligationsByRoundId.get(round.id) ?? [];
          const roundStatus = getRoundStatusBadge(round.status, round.closureBasis);

          return (
            <Card key={round.id} title={`${copy.round} ${round.roundNumber} · ${round.recipientDisplayName}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge label={roundStatus.label} className={roundStatus.className} />
                <p className="text-xs text-[#7b8179]">{copy.due} {formatOwnerDate(round.dueDate)}</p>
              </div>

              {roundObligations.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-[#587066]">{copy.noObligations}</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-4">
                  {roundObligations.map((obligation) => (
                    <ObligationCard
                      key={obligation.id}
                      circleId={circleId}
                      obligation={obligation}
                      payments={paymentsByObligationId.get(obligation.id) ?? []}
                      readOnly={readOnly}
                      dictionary={dictionary}
                    />
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
