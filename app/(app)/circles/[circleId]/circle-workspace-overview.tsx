import Link from "next/link";

import type { ActiveCircleOwnerSummaryResult } from "@/src/services/circle-active-owner.service";
import type { CompletedCircleOwnerSummaryResult } from "@/src/services/circle-completed-owner.service";
import type { OwnerCircleContributionsResult } from "@/src/services/contribution-owner-read.service";
import type { OwnerCirclePayoutsResult, OwnerPayoutsRoundResult } from "@/src/services/payout-owner-read.service";
import type { OwnerRoundLifecycleResult } from "@/src/services/round-lifecycle-owner-read.service";

import { formatContributionMoney } from "./contribution-desk-display";
import { getPayoutStatusPresentation } from "./payout-desk-display";
import { getFrequencyLabel } from "../new/new-circle-form-display";
import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";
import { getBlockerMessage } from "./round-lifecycle-display";

function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dce9dc] text-xs font-bold tracking-wide text-[#285347]">{initials}</span>;
}

function ArrowLink({ circleId, section, children }: { circleId: string; section: string; children: React.ReactNode }) {
  return <Link href={`/circles/${circleId}?section=${section}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-[#35634f] hover:text-[#173b32] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">{children} <span aria-hidden="true" className="ml-1">→</span></Link>;
}

function Stat({ label, value, supporting }: { label: string; value: string; supporting: string }) {
  return <div className="min-w-0 border-l border-[#e7ded1] px-4 first:border-l-0 first:pl-0 sm:px-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7b8179]">{label}</p><p className="mt-2 truncate text-lg font-semibold text-[#173b32]">{value}</p><p className="mt-1 truncate text-xs text-[#587066]">{supporting}</p></div>;
}

function getPayoutState(round: OwnerPayoutsRoundResult | undefined, lifecycle: OwnerRoundLifecycleResult): string {
  if (!round) return "No payout is scheduled yet";
  if (round.payout) return getPayoutStatusPresentation(round.payout.status).label;
  if (lifecycle.progression.blocker === "CONTRIBUTIONS_INCOMPLETE") return "Waiting for contributions";
  if (lifecycle.progression.blocker === "PAYOUT_MISSING") return "Ready to record";
  return "Not yet recorded";
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
  const currentPayout = currentRound ? payouts.rounds.find((round) => round.id === currentRound.id) : undefined;
  const roundObligations = currentRound ? contributions.obligations.filter((item) => item.roundId === currentRound.id) : [];
  const receivedCount = roundObligations.filter((item) => item.outstandingAmount === "0.00").length;
  const roundBadge = currentRound ? getRoundStatusBadge(currentRound.status) : null;
  const previewRounds = summary.rounds.slice(0, 4);

  return (
    <div className="max-w-5xl">
      <div className="border-b border-[#e2d7c9] pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circles <span aria-hidden="true">›</span> {summary.circle.name}</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="font-serif text-4xl tracking-tight text-[#173b32] sm:text-5xl">{summary.circle.name}</h1><p className="mt-2 max-w-2xl leading-7 text-[#587066]">A calm view of your shared savings rotation and its next step.</p></div>
          <span className="rounded-full bg-[#dce9dc] px-3 py-1.5 text-xs font-bold tracking-wide text-[#35634f]">ACTIVE</span>
        </div>
      </div>

      <section aria-label="Circle summary" className="grid grid-cols-2 gap-y-5 border-b border-[#e2d7c9] py-6 sm:grid-cols-4 sm:gap-y-0">
        <Stat label="Contribution" value={`${summary.circle.currency} ${summary.circle.contributionAmount}`} supporting={getFrequencyLabel(summary.circle.frequency)} />
        <Stat label="Members" value={String(summary.members.length)} supporting="active members" />
        <Stat label="Started" value={formatOwnerDate(summary.circle.startDate)} supporting="circle start date" />
        <Stat label="Round" value={currentRound ? `${currentRound.roundNumber} of ${lifecycle.totalRounds}` : "Not started"} supporting={currentRound?.recipient.displayName ?? "rotation pending"} />
      </section>

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.9fr)]">
        <section className="rounded-[1.5rem] bg-[#173b32] p-6 text-[#fffaf2] sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">Current round</p>{roundBadge ? <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">{roundBadge.label}</span> : null}</div>
          {currentRound ? <><div className="mt-7 flex items-center gap-4"><Initials name={currentRound.recipient.displayName} /><div><p className="text-2xl font-semibold">{currentRound.recipient.displayName}</p><p className="mt-1 text-sm text-[#d8e7d9]">Current recipient · Due {formatOwnerDate(currentRound.dueDate)}</p></div></div><div className="mt-7"><div className="flex items-baseline justify-between gap-3"><p className="text-sm font-medium">Contribution progress</p><p className="text-sm text-[#d8e7d9]">{receivedCount} of {roundObligations.length} received</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#d9bd77]" style={{ width: `${roundObligations.length === 0 ? 0 : (receivedCount / roundObligations.length) * 100}%` }} /></div></div><p className="mt-5 max-w-xl text-sm leading-6 text-[#d8e7d9]">{lifecycle.progression.blocker ? getBlockerMessage(lifecycle.progression.blocker) : lifecycle.phase === "NOT_STARTED" ? "The rotation is ready to begin when you are ready." : "This round is ready for its next recorded step."}</p></> : <p className="mt-6 text-sm text-[#d8e7d9]">No current round is available.</p>}
          <ArrowLink circleId={circleId} section="contributions">Record contributions</ArrowLink>
        </section>

        <section className="rounded-[1.5rem] border border-[#e2d7c9] bg-[#fffdf8] p-6 sm:p-7">
          <p className="text-sm font-semibold text-[#173b32]">Next payout</p>
          {currentPayout ? <><div className="mt-6 flex items-center gap-3"><Initials name={currentPayout.recipient.displayName} /><div><p className="font-semibold text-[#173b32]">{currentPayout.recipient.displayName}</p><p className="text-sm text-[#587066]">Round {currentPayout.roundNumber} recipient</p></div></div><p className="mt-7 font-serif text-3xl text-[#173b32]">{formatContributionMoney(currentPayout.expectedPayout.amount, currentPayout.expectedPayout.currency)}</p><p className="mt-1 text-sm text-[#587066]">Expected payout for this round</p><p className="mt-5 inline-flex rounded-full bg-[#fff0d9] px-3 py-1.5 text-xs font-semibold text-[#8a5b27]">{getPayoutState(currentPayout, lifecycle)}</p></> : <p className="mt-6 text-sm leading-6 text-[#587066]">The payout amount will appear once the rotation has a current round.</p>}
          <ArrowLink circleId={circleId} section="payouts">View payouts</ArrowLink>
        </section>
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem]">
        <section><div className="flex items-center justify-between"><h2 className="font-serif text-2xl text-[#173b32]">Members</h2><ArrowLink circleId={circleId} section="members">View all</ArrowLink></div><ul className="mt-3 divide-y divide-[#e7ded1]">{summary.members.slice(0, 4).map((member) => <li key={member.id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3"><Initials name={member.displayName} /><p className="truncate text-sm font-medium text-[#173b32]">{member.displayName}</p></div><span className="text-xs font-semibold text-[#35634f]">Active</span></li>)}</ul></section>
        <section><div className="flex items-center justify-between"><h2 className="font-serif text-2xl text-[#173b32]">Upcoming rounds</h2><ArrowLink circleId={circleId} section="schedule">Full schedule</ArrowLink></div><ol className="mt-3 divide-y divide-[#e7ded1]">{previewRounds.map((round) => <li key={round.id} className="flex items-center gap-3 py-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f3ede3] text-xs font-bold text-[#587066]">{round.roundNumber}</span><p className="min-w-0 flex-1 truncate text-sm font-medium text-[#173b32]">{round.recipientDisplayName}</p><p className="text-xs text-[#587066]">{formatOwnerDate(round.dueDate)}</p><span className={`rounded-full px-2 py-1 text-[0.625rem] font-semibold ${getRoundStatusBadge(round.status).className}`}>{getRoundStatusBadge(round.status).label}</span></li>)}</ol></section>
        <section className="hidden rounded-[1.25rem] bg-[#f3ede3] p-5 lg:block"><h2 className="font-serif text-xl text-[#173b32]">Quick actions</h2><div className="mt-3 grid"><ArrowLink circleId={circleId} section="contributions">Contributions</ArrowLink><ArrowLink circleId={circleId} section="payouts">Payouts</ArrowLink><ArrowLink circleId={circleId} section="members">Members</ArrowLink><ArrowLink circleId={circleId} section="schedule">Schedule</ArrowLink></div></section>
      </div>
    </div>
  );
}

export function CompletedCircleWorkspaceOverview({ summary }: { summary: CompletedCircleOwnerSummaryResult }) {
  return <div className="max-w-4xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circles <span aria-hidden="true">›</span> {summary.circle.name}</p><section className="mt-4 rounded-[1.5rem] border border-[#e2d7c9] bg-[#fffdf8] p-7 sm:p-9"><span className="rounded-full bg-[#efe7db] px-3 py-1.5 text-xs font-bold tracking-wide text-[#587066]">COMPLETED</span><h1 className="mt-4 font-serif text-4xl tracking-tight text-[#173b32]">{summary.circle.name}</h1><p className="mt-3 max-w-xl leading-7 text-[#587066]">Circle complete. Its contribution and payout records are now historical and read-only.</p><dl className="mt-7 grid gap-5 sm:grid-cols-3"><Stat label="Contribution" value={`${summary.circle.currency} ${summary.circle.contributionAmount}`} supporting={getFrequencyLabel(summary.circle.frequency)} /><Stat label="Members" value={String(summary.memberCount)} supporting="rotation members" /><Stat label="Completed" value={formatOwnerDate(summary.circle.completedAt)} supporting="historical record" /></dl></section></div>;
}
