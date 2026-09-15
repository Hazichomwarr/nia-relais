import type { OwnerRoundLifecycleResult } from "@/src/services/round-lifecycle-owner-read.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";
import { CompleteCircleForm } from "./complete-circle-controls";
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
    <section className="border-t border-[#e2d7c9] pt-6">
      <h2 className="font-serif text-2xl tracking-tight text-[#173b32]">{title}</h2>
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
  dictionary,
}: {
  label: string;
  round: OwnerRoundLifecycleResult["currentRound"];
  dictionary: Dictionary;
}) {
  if (!round) return null;
  const status = getRoundStatusBadge(round.status);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{label}</span>
      <Badge label={round.status === "ACTIVE" ? dictionary.susuFinancial.active : round.status === "UPCOMING" ? dictionary.susuFinancial.upcoming : round.status === "CLOSED" ? dictionary.susuFinancial.closed : status.label} className={status.className} />
      <p className="text-sm text-[#173b32]">{dictionary.susuFinancial.round} {round.roundNumber} · {round.recipient.displayName}</p>
      <p className="text-xs text-[#7b8179]">{dictionary.susuFinancial.scheduledDate} {formatOwnerDate(round.dueDate)}</p>
    </div>
  );
}

export function RoundLifecycleCard({
  circleId,
  lifecycle,
  dictionary,
}: {
  circleId: string;
  lifecycle: OwnerRoundLifecycleResult;
  dictionary: Dictionary;
}) {
  const copy = dictionary.susuFinancial;
  const { phase, totalRounds, closedRounds, currentRound, nextRound, progression } = lifecycle;

  return (
    <Card title={copy.advanceRound}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">
        {closedRounds} / {totalRounds} {copy.roundsClosed}
      </p>

      {phase === "NOT_STARTED" ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm leading-6 text-[#587066]">
            {copy.notStartedDescription}
          </p>
          {nextRound ? <RoundSummary label={`${copy.round} 1`} round={nextRound} dictionary={dictionary} /> : null}
          {progression.canStartFirstRound ? <StartFirstRoundForm circleId={circleId} dictionary={dictionary} /> : null}
        </div>
      ) : null}

      {phase === "IMPORTED_PREFIX_AWAITING_FIRST_ROUND" ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm leading-6 text-[#587066]">
            {nextRound
              ? copy.importedPrefixDescription.replace("{count}", String(closedRounds)).replace("{number}", String(nextRound.roundNumber))
              : null}
          </p>
          {nextRound ? <RoundSummary label={`${copy.round} ${nextRound.roundNumber}`} round={nextRound} dictionary={dictionary} /> : null}
          {progression.canStartFirstRound ? <StartFirstRoundForm circleId={circleId} dictionary={dictionary} variant="imported" /> : null}
        </div>
      ) : null}

      {phase === "IN_PROGRESS" ? (
        <div className="mt-4 flex flex-col gap-4">
          <RoundSummary label={copy.currentRound} round={currentRound} dictionary={dictionary} />
          {nextRound ? <RoundSummary label={copy.nextRound} round={nextRound} dictionary={dictionary} /> : null}

          {progression.blocker ? (
            <p className="text-sm leading-6 text-[#587066]">{progression.blocker === "CONTRIBUTIONS_INCOMPLETE" ? copy.waitingContributions : progression.blocker === "PAYOUT_DISPUTED" ? copy.payoutDisputed : copy.waitingPayout}</p>
          ) : null}

          {progression.canAdvanceCurrentRound && currentRound ? (
            <AdvanceRoundForm
              circleId={circleId}
              dictionary={dictionary}
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
          <p className="text-sm leading-6 text-[#587066]">{copy.allRoundsClosed}</p>
          <p className="mt-2 text-sm leading-6 text-[#587066]">{copy.completionPending}</p>
          <CompleteCircleForm circleId={circleId} dictionary={dictionary} />
        </div>
      ) : null}
    </Card>
  );
}
