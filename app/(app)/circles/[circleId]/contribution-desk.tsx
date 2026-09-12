import type {
  OwnerCircleContributionsResult,
  OwnerContributionsObligationResult,
  OwnerContributionsPaymentResult,
} from "@/src/services/contribution-owner-read.service";

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
    <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">{title}</h2>
      <div className="mt-5">{children}</div>
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
}: {
  circleId: string;
  payment: OwnerContributionsPaymentResult;
  readOnly: boolean;
}) {
  const presentation = getPaymentStatusPresentation(payment.status);

  return (
    <li className="rounded-xl bg-white/70 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[#173b32]">{formatContributionMoney(payment.amount, payment.currency)}</span>
        <Badge label={presentation.label} className={presentation.className} />
      </div>
      <p className="mt-1 text-xs text-[#7b8179]">{presentation.description}</p>
      <p className="mt-1 text-xs text-[#7b8179]">Recorded {formatContributionDateTime(payment.recordedAt)}</p>
      {payment.confirmedAt ? (
        <p className="text-xs text-[#7b8179]">Confirmed {formatContributionDateTime(payment.confirmedAt)}</p>
      ) : null}
      {payment.rejectedAt ? (
        <p className="text-xs text-[#7b8179]">Rejected {formatContributionDateTime(payment.rejectedAt)}</p>
      ) : null}
      {payment.rejectionReason ? (
        <p className="mt-1 text-xs text-[#8d4f42]">Reason: {payment.rejectionReason}</p>
      ) : null}

      {!readOnly && payment.status === "RECORDED" ? (
        <div className="mt-3">
          <ContributionPaymentControls circleId={circleId} paymentId={payment.id} />
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
}: {
  circleId: string;
  obligation: OwnerContributionsObligationResult;
  payments: readonly OwnerContributionsPaymentResult[];
  readOnly: boolean;
}) {
  const canRecord = !readOnly && canRecordFreshContribution(obligation, payments);
  const history = sortPaymentsNewestFirst(payments);
  const statusPresentation = getObligationStatusPresentation(obligation.status);

  return (
    <li className="rounded-2xl border border-[#efe6d8] bg-[#fffaf2] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#173b32]">
          {obligation.memberDisplayName} <span className="text-xs text-[#7b8179]">({obligation.memberCode})</span>
        </p>
        <Badge label={statusPresentation.label} className={statusPresentation.className} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Expected</dt>
          <dd className="mt-1 text-[#173b32]">{formatContributionMoney(obligation.expectedAmount, obligation.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Confirmed</dt>
          <dd className="mt-1 text-[#173b32]">{formatContributionMoney(obligation.confirmedAmount, obligation.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Outstanding</dt>
          <dd className="mt-1 text-[#173b32]">{formatContributionMoney(obligation.outstandingAmount, obligation.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Due</dt>
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
          />
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Payment history</p>
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((payment) => (
              <PaymentHistoryItem key={payment.id} circleId={circleId} payment={payment} readOnly={readOnly} />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function ContributionDesk({
  circleId,
  contributions,
  readOnly,
}: {
  circleId: string;
  contributions: OwnerCircleContributionsResult;
  readOnly: boolean;
}) {
  const { rounds, obligations, payments } = contributions;
  const obligationsByRoundId = groupObligationsByRoundId(obligations);
  const paymentsByObligationId = groupPaymentsByObligationId(payments);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Contribution desk">
        <p className="text-sm leading-6 text-[#587066]">
          {readOnly
            ? "This circle is complete. The contribution history below is a permanent record and can no longer be changed."
            : "Record a contribution once a member has actually given it to you, and confirm it only after you have verified you received it outside NIA. NIA tracks the circle; it does not hold or move the money."}
        </p>
      </Card>

      {rounds.length === 0 ? (
        <Card title="Rounds">
          <p className="text-sm leading-6 text-[#587066]">No rounds exist for this circle yet.</p>
        </Card>
      ) : (
        rounds.map((round) => {
          const roundObligations = obligationsByRoundId.get(round.id) ?? [];
          const roundStatus = getRoundStatusBadge(round.status);

          return (
            <Card key={round.id} title={`Round ${round.roundNumber} · ${round.recipientDisplayName}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge label={roundStatus.label} className={roundStatus.className} />
                <p className="text-xs text-[#7b8179]">Due {formatOwnerDate(round.dueDate)}</p>
              </div>

              {roundObligations.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-[#587066]">No obligations exist for this round.</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-4">
                  {roundObligations.map((obligation) => (
                    <ObligationCard
                      key={obligation.id}
                      circleId={circleId}
                      obligation={obligation}
                      payments={paymentsByObligationId.get(obligation.id) ?? []}
                      readOnly={readOnly}
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
