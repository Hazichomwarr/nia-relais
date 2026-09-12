import Link from "next/link";

import type { ActiveCircleOwnerSummaryResult } from "@/src/services/circle-active-owner.service";
import type { CompletedCircleOwnerSummaryResult } from "@/src/services/circle-completed-owner.service";
import type { OwnerCircleContributionsResult } from "@/src/services/contribution-owner-read.service";
import type { OwnerCirclePayoutsResult } from "@/src/services/payout-owner-read.service";
import type { OwnerRoundLifecycleResult } from "@/src/services/round-lifecycle-owner-read.service";

import { getFrequencyLabel } from "../new/new-circle-form-display";
import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";
import { getBlockerMessage } from "./round-lifecycle-display";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SectionLink({ circleId, section, children }: { circleId: string; section: string; children: React.ReactNode }) {
  return <Link href={`/circles/${circleId}?section=${section}`} className="mt-4 inline-flex text-sm font-semibold text-[#8d4f42] underline decoration-[#d5a38f] underline-offset-4 hover:text-[#6d3c32]">{children}</Link>;
}

export function ActiveCircleWorkspaceOverview({
  circleId,
  summary,
  contributions,
  payouts,
  lifecycle,
}: {
  circleId: string;
  summary: ActiveCircleOwnerSummaryResult;
  contributions: OwnerCircleContributionsResult;
  payouts: OwnerCirclePayoutsResult;
  lifecycle: OwnerRoundLifecycleResult;
}) {
  const currentRound = lifecycle.currentRound ?? lifecycle.nextRound;
  const roundBadge = currentRound ? getRoundStatusBadge(currentRound.status) : null;
  const outstandingCount = contributions.obligations.filter((item) => item.outstandingAmount !== "0.00").length;
  const payoutSummary = payouts.summary;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circle</p>
        <span className="mt-3 inline-flex rounded-full bg-[#e6f0e8] px-3 py-1 text-sm font-semibold text-[#35634f]">ACTIVE</span>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{summary.circle.name}</h1>
        <p className="mt-3 leading-7 text-[#587066]">{summary.circle.currency} {summary.circle.contributionAmount} · {getFrequencyLabel(summary.circle.frequency)} · {summary.members.length} members</p>
      </section>

      <Card title="Where your circle is now">
        {currentRound ? (
          <div className="flex flex-wrap items-center gap-2">
            {roundBadge ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${roundBadge.className}`}>{roundBadge.label}</span> : null}
            <p className="font-semibold text-[#173b32]">Round {currentRound.roundNumber} of {lifecycle.totalRounds} · {currentRound.recipient.displayName}</p>
            <p className="text-sm text-[#587066]">Scheduled for {formatOwnerDate(currentRound.dueDate)}</p>
          </div>
        ) : <p className="text-sm leading-6 text-[#587066]">The rotation has no current or upcoming round to show.</p>}
        <p className="mt-4 text-sm leading-6 text-[#587066]">
          {lifecycle.phase === "ALL_ROUNDS_CLOSED"
            ? "All rotation rounds are closed. The next step is to mark this circle complete."
            : lifecycle.progression.blocker
              ? getBlockerMessage(lifecycle.progression.blocker)
              : lifecycle.phase === "NOT_STARTED"
                ? "The rotation is ready to start when you are ready."
                : "This round is ready for its next recorded step."}
        </p>
        <SectionLink circleId={circleId} section="schedule">View schedule and next action</SectionLink>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Contributions">
          <p className="text-sm leading-6 text-[#587066]">{outstandingCount === 0 ? "All recorded contribution obligations are currently covered." : `${outstandingCount} contribution${outstandingCount === 1 ? "" : "s"} remaining.`}</p>
          <SectionLink circleId={circleId} section="contributions">Review contributions</SectionLink>
        </Card>
        <Card title="Payouts">
          <p className="text-sm leading-6 text-[#587066]">{payoutSummary.disputedCount > 0 ? `${payoutSummary.disputedCount} payout${payoutSummary.disputedCount === 1 ? " is" : "s are"} disputed.` : payoutSummary.recordedCount > 0 ? `${payoutSummary.recordedCount} payout${payoutSummary.recordedCount === 1 ? " is" : "s are"} waiting for confirmation.` : payoutSummary.unrecordedCount > 0 ? `${payoutSummary.unrecordedCount} payout${payoutSummary.unrecordedCount === 1 ? " has" : "s have"} not been recorded.` : "Payout records are up to date."}</p>
          <SectionLink circleId={circleId} section="payouts">Review payouts</SectionLink>
        </Card>
      </div>
    </div>
  );
}

export function CompletedCircleWorkspaceOverview({ summary }: { summary: CompletedCircleOwnerSummaryResult }) {
  return (
    <div className="max-w-3xl">
      <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circle</p>
        <span className="mt-3 inline-flex rounded-full bg-[#efe7db] px-3 py-1 text-sm font-semibold text-[#587066]">COMPLETED</span>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{summary.circle.name}</h1>
        <p className="mt-3 leading-7 text-[#587066]">Circle complete. Its contribution and payout records are now historical and read-only.</p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Contribution</dt><dd className="mt-1 text-[#173b32]">{summary.circle.currency} {summary.circle.contributionAmount}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Members</dt><dd className="mt-1 text-[#173b32]">{summary.memberCount}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Completed</dt><dd className="mt-1 text-[#173b32]">{formatOwnerDate(summary.circle.completedAt)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
