import type { OwnerRoundLifecycleResult } from "@/src/services/round-lifecycle-owner-read.service";

import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";
import { getBlockerMessage } from "./round-lifecycle-display";
import { AdvanceRoundForm, StartFirstRoundForm } from "./round-lifecycle-controls";

// Owner-only round-lifecycle card (7K.16): renders exactly what
// getOwnerRoundLifecycle (round-lifecycle-owner-read.service.ts, 7K.15)
// returns and delegates every mutation to activateFirstRoundAction/
// advanceRoundAction (7K.14, via round-lifecycle-controls.tsx) -- this
// file computes no eligibility of its own. Every enabled/disabled
// decision below reads directly from `lifecycle.progression`
// (canStartFirstRound/canAdvanceCurrentRound/blocker/transitionKind) --
// never from ContributionPayment/ContributionObligation/Payout data,
// which this component never receives in the first place (it only ever
// sees the already-serialized OwnerRoundLifecycleResult, a completely
// separate read model from ContributionDesk's/PayoutDesk's own). No date
// (dueDate, startDate, Date.now()) ever gates which control renders --
// dueDate is formatted for display only.
//
// Placement (7K.16 section 5): rendered between ActiveCircleSummary and
// ContributionDesk on the owner circle page -- the lifecycle card
// explains WHERE the circle currently is in its rotation, while the
// financial desks below it explain the records needed to progress it.

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

function RoundSummary({
  label,
  round,
}: {
  label: string;
  round: OwnerRoundLifecycleResult["currentRound"];
}) {
  if (!round) return null;
  const status = getRoundStatusBadge(round.status);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{label}</span>
      <Badge {...status} />
      <p className="text-sm text-[#173b32]">
        Round {round.roundNumber} · {round.recipient.displayName}{" "}
        <span className="text-xs text-[#7b8179]">({round.recipient.memberCode})</span>
      </p>
      <p className="text-xs text-[#7b8179]">Scheduled date {formatOwnerDate(round.dueDate)}</p>
    </div>
  );
}

export function RoundLifecycleCard({
  circleId,
  lifecycle,
}: {
  circleId: string;
  lifecycle: OwnerRoundLifecycleResult;
}) {
  const { phase, totalRounds, closedRounds, currentRound, nextRound, progression } = lifecycle;

  return (
    <Card title="Round lifecycle">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">
        {closedRounds} / {totalRounds} rounds closed
      </p>

      {phase === "NOT_STARTED" ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm leading-6 text-[#587066]">
            This circle is active, but its rotation has not started yet. Round 1 will begin only when you explicitly
            start it — nothing happens automatically.
          </p>
          {nextRound ? <RoundSummary label="Round 1" round={nextRound} /> : null}
          {progression.canStartFirstRound ? <StartFirstRoundForm circleId={circleId} /> : null}
        </div>
      ) : null}

      {phase === "IN_PROGRESS" ? (
        <div className="mt-4 flex flex-col gap-4">
          <RoundSummary label="Current round" round={currentRound} />
          {nextRound ? <RoundSummary label="Next round" round={nextRound} /> : null}

          {progression.blocker ? (
            <p className="text-sm leading-6 text-[#587066]">{getBlockerMessage(progression.blocker)}</p>
          ) : null}

          {progression.canAdvanceCurrentRound && currentRound ? (
            <AdvanceRoundForm
              circleId={circleId}
              roundId={currentRound.id}
              transitionKind={progression.transitionKind === "CLOSE_FINAL_ROUND" ? "CLOSE_FINAL_ROUND" : "ADVANCE_TO_NEXT_ROUND"}
              currentRoundNumber={currentRound.roundNumber}
              nextRoundNumber={nextRound ? nextRound.roundNumber : null}
            />
          ) : null}
        </div>
      ) : null}

      {phase === "ALL_ROUNDS_CLOSED" ? (
        <div className="mt-4">
          <p className="text-sm leading-6 text-[#587066]">All rotation rounds are closed.</p>
          <p className="mt-2 text-sm leading-6 text-[#587066]">The circle has not yet been marked complete in NIA.</p>
        </div>
      ) : null}
    </Card>
  );
}
