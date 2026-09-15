import type { MemberCirclePayoutsResult } from "@/src/services/payout-member-read.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

import { formatCircleDate, formatCircleDateTime, formatCircleMoney } from "./member-dashboard-display";
import { canDecidePayout, getMemberPayoutStatusPresentation } from "./member-payout-display";
import { MemberPayoutControls } from "./member-payout-controls";

// Read-only orchestration of getCircleMemberPayouts' own result (7K.8) --
// this component queries nothing itself (no Prisma, no duplicate read
// model, no obligation summing, no recipient-identity inference) and
// invents no eligibility rule beyond what member-payout-display.ts
// already derives from persisted facts. This is ADDITIVE to the existing
// member dashboard (7H.2/7H.3, its own MyPayoutCard is left completely
// unmodified): getCircleMemberDashboard is not rewritten to carry
// disputeReason/expectedPayout -- this card is the one place that renders
// that richer, already-scoped-at-the-database-layer detail, plus the
// recipient's own confirm/dispute decision controls.
//
// recipientRounds has at most one entry today
// (PayoutRound.@@unique([circleId, recipientId])), but this component
// does not hard-code that assumption beyond reading the first entry if
// one exists -- an empty array (the member is not a recipient of any
// round) is handled truthfully by rendering nothing at all, never an
// error page and never a fabricated payout.

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h2 className="text-lg font-semibold tracking-tight text-[#173b32] sm:text-xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailList({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{label}</dt>
      <dd className="mt-1 text-base text-[#173b32]">{value}</dd>
    </div>
  );
}

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${className}`}>{label}</span>;
}

export function MemberPayoutCard({
  circleId,
  payouts,
  dictionary,
  locale,
}: {
  circleId: string;
  payouts: MemberCirclePayoutsResult;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.memberWorkspace;
  // 7K.10 section 5: a member who is not the recipient of any persisted
  // round (the common case) truthfully has nothing to show here -- this
  // is not an error, and no payout is ever fabricated to fill the gap.
  const round = payouts.recipientRounds[0];
  if (!round) return null;

  const { payout } = round;
  const presentation = getMemberPayoutStatusPresentation(payout ? payout.status : null, payout?.confirmationBasis);
  const statusCopy = payout === null
    ? { label: copy.payoutNotRecorded, description: copy.payoutNotRecordedDescription }
    : payout.confirmationBasis === "IMPORTED_DECLARATION"
      ? { label: copy.importedHistory, description: copy.importedHistoryDescription }
      : payout.status === "RECORDED"
        ? { label: copy.payoutAwaitingDecision, description: copy.payoutAwaitingDecisionDescription }
        : payout.status === "CONFIRMED"
          ? { label: copy.payoutConfirmed, description: copy.payoutConfirmedDescription }
          : { label: copy.payoutDisputed, description: copy.payoutDisputedDescription };
  const canDecide = canDecidePayout(payout);
  const isImportedPayout = payout?.confirmationBasis === "IMPORTED_DECLARATION";

  return (
    <Card title={copy.myPayout}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge label={statusCopy.label} className={presentation.className} />
        <span className="text-sm text-[#587066]">{copy.round} {round.roundNumber}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#587066]">{statusCopy.description}</p>

      <DetailList>
        <DetailRow label={copy.due} value={formatCircleDate(round.dueDate, locale)} />
        <DetailRow
          label={copy.expectedPayout}
          value={formatCircleMoney(round.expectedPayout.amount, round.expectedPayout.currency)}
        />
      </DetailList>

      {payout ? (
        <DetailList>
          <DetailRow label={copy.recordedAmount} value={formatCircleMoney(payout.amount, payout.currency)} />
          <DetailRow label={copy.recorded} value={formatCircleDateTime(payout.recordedAt, locale)} />
          {payout.confirmedAt && !isImportedPayout ? <DetailRow label={copy.confirmed} value={formatCircleDateTime(payout.confirmedAt, locale)} /> : null}
          {payout.disputedAt ? <DetailRow label={copy.disputed} value={formatCircleDateTime(payout.disputedAt, locale)} /> : null}
        </DetailList>
      ) : null}

      {payout?.disputeReason ? (
        <p className="mt-3 text-sm leading-6 break-words text-[#8d4f42]">
          <span className="font-semibold">{copy.reportedReason}</span> {payout.disputeReason}
        </p>
      ) : null}

      {canDecide && payout ? (
        <div className="mt-4">
          <MemberPayoutControls circleId={circleId} payoutId={payout.id} dictionary={dictionary} />
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-[#7b8179]">
        {copy.payoutExternalDescription}
      </p>
    </Card>
  );
}
