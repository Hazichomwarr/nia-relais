import type { MemberCirclePayoutsResult } from "@/src/services/payout-member-read.service";

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
}: {
  circleId: string;
  payouts: MemberCirclePayoutsResult;
}) {
  // 7K.10 section 5: a member who is not the recipient of any persisted
  // round (the common case) truthfully has nothing to show here -- this
  // is not an error, and no payout is ever fabricated to fill the gap.
  const round = payouts.recipientRounds[0];
  if (!round) return null;

  const { payout } = round;
  const presentation = getMemberPayoutStatusPresentation(payout ? payout.status : null);
  const canDecide = canDecidePayout(payout);

  return (
    <Card title="My payout">
      <div className="flex flex-wrap items-center gap-3">
        <Badge label={presentation.label} className={presentation.className} />
        <span className="text-sm text-[#587066]">Round {round.roundNumber}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#587066]">{presentation.description}</p>

      <DetailList>
        <DetailRow label="Due" value={formatCircleDate(round.dueDate)} />
        <DetailRow
          label="Expected payout"
          value={formatCircleMoney(round.expectedPayout.amount, round.expectedPayout.currency)}
        />
      </DetailList>

      {payout ? (
        <DetailList>
          <DetailRow label="Recorded amount" value={formatCircleMoney(payout.amount, payout.currency)} />
          <DetailRow label="Recorded" value={formatCircleDateTime(payout.recordedAt)} />
          {payout.confirmedAt ? <DetailRow label="Confirmed" value={formatCircleDateTime(payout.confirmedAt)} /> : null}
          {payout.disputedAt ? <DetailRow label="Disputed" value={formatCircleDateTime(payout.disputedAt)} /> : null}
        </DetailList>
      ) : null}

      {payout?.disputeReason ? (
        <p className="mt-3 text-sm leading-6 break-words text-[#8d4f42]">
          <span className="font-semibold">Your reported reason:</span> {payout.disputeReason}
        </p>
      ) : null}

      {canDecide && payout ? (
        <div className="mt-4">
          <MemberPayoutControls circleId={circleId} payoutId={payout.id} />
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-[#7b8179]">
        NIA records payouts that happen outside the app -- it does not send, hold, or transfer money.
      </p>
    </Card>
  );
}
