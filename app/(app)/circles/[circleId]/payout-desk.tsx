import type { OwnerCirclePayoutsResult, OwnerPayoutsRoundResult } from "@/src/services/payout-owner-read.service";

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
    <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">{title}</h2>
      <div className="mt-5">{children}</div>
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
}: {
  circleId: string;
  round: OwnerPayoutsRoundResult;
  readOnly: boolean;
}) {
  const roundStatus = getRoundStatusBadge(round.status);
  const presentation = getPayoutStatusPresentation(round.payout ? round.payout.status : null);
  const canRecord = !readOnly && canRecordFreshPayout(round.payout);

  return (
    <Card title={`Round ${round.roundNumber} · ${round.recipient.displayName}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge label={roundStatus.label} className={roundStatus.className} />
        <p className="text-xs text-[#7b8179]">
          ({round.recipient.memberCode}) · Due {formatOwnerDate(round.dueDate)}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Expected payout</dt>
          <dd className="mt-1 text-[#173b32]">
            {formatContributionMoney(round.expectedPayout.amount, round.expectedPayout.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Status</dt>
          <dd className="mt-1">
            <Badge label={presentation.label} className={presentation.className} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-5 text-[#7b8179]">{presentation.description}</p>

      {round.payout ? (
        <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm">
          <p className="font-semibold text-[#173b32]">
            {formatContributionMoney(round.payout.amount, round.payout.currency)}
          </p>
          <p className="mt-1 text-xs text-[#7b8179]">Recorded {formatContributionDateTime(round.payout.recordedAt)}</p>
          {round.payout.confirmedAt ? (
            <p className="text-xs text-[#7b8179]">Confirmed {formatContributionDateTime(round.payout.confirmedAt)}</p>
          ) : null}
          {round.payout.disputedAt ? (
            <p className="text-xs text-[#7b8179]">Disputed {formatContributionDateTime(round.payout.disputedAt)}</p>
          ) : null}
          {round.payout.disputeReason ? (
            <p className="mt-1 text-xs leading-5 break-words text-[#8d4f42]">
              Reason: {round.payout.disputeReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {canRecord ? (
        <div className="mt-4">
          <RecordPayoutForm
            circleId={circleId}
            roundId={round.id}
            amount={round.expectedPayout.amount}
            currency={round.expectedPayout.currency}
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
}: {
  circleId: string;
  payouts: OwnerCirclePayoutsResult;
  readOnly: boolean;
}) {
  const { rounds, summary } = payouts;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Payouts">
        <p className="text-sm leading-6 text-[#587066]">
          {readOnly
            ? "This circle is complete. The payout history below is a permanent record and can no longer be changed."
            : "Record a payout once you have actually paid the recipient outside NIA. NIA records payouts that happen outside the app -- it does not send, hold, or transfer the money."}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Total rounds</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.totalRounds}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Unrecorded</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.unrecordedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Recorded</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.recordedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Confirmed</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.confirmedCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Disputed</dt>
            <dd className="mt-1 text-base text-[#173b32]">{summary.disputedCount}</dd>
          </div>
        </dl>
      </Card>

      {rounds.length === 0 ? (
        <Card title="Rounds">
          <p className="text-sm leading-6 text-[#587066]">No rounds exist for this circle yet.</p>
        </Card>
      ) : (
        rounds.map((round) => <RoundCard key={round.id} circleId={circleId} round={round} readOnly={readOnly} />)
      )}
    </div>
  );
}
