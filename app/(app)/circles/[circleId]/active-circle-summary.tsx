import type { ActiveCircleOwnerSummaryResult } from "@/src/services/circle-active-owner.service";

import { getFrequencyLabel } from "../new/new-circle-form-display";
import { formatOwnerDate, getRoundStatusBadge } from "./circle-workspace-display";

// Read-only. Renders exactly what getActiveCircleSummaryForOwner returns --
// persisted rounds (recipientId/dueDate/status straight from the
// PayoutRound row, never recomputed from current member order), the ACTIVE
// member list, and the current/next round position. No contribution or
// payout figures exist anywhere here (out of scope for this ticket, and
// the service itself computes none), and no recording/confirmation
// control is rendered -- this is display only.

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

export function ActiveCircleSummary({ summary }: { summary: ActiveCircleOwnerSummaryResult }) {
  const { circle, members, rounds, currentRound, nextRound, totalRoundCount, closedRoundCount } = summary;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circles</p>
        <span className="mt-3 inline-flex w-fit rounded-full bg-[#e6f0e8] px-3 py-1 text-sm font-semibold text-[#35634f]">
          ACTIVE
        </span>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{circle.name}</h1>
        <p className="mt-4 max-w-xl leading-7 text-[#587066]">
          This circle is active. Its members, contribution terms, and payout order are now fixed and can no longer
          be changed.
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Contribution</dt>
            <dd className="mt-1 text-base text-[#173b32]">
              {circle.currency} {circle.contributionAmount} · {getFrequencyLabel(circle.frequency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Started</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Activated</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.activatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Members</dt>
            <dd className="mt-1 text-base text-[#173b32]">{members.length}</dd>
          </div>
        </dl>
      </section>

      <Card title="Current round">
        {currentRound ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge {...getRoundStatusBadge(currentRound.status)} />
            <p className="text-sm text-[#173b32]">
              Round {currentRound.roundNumber} · {currentRound.recipientDisplayName}{" "}
              <span className="text-xs text-[#7b8179]">({currentRound.recipientMemberCode})</span>
            </p>
            <p className="text-xs text-[#7b8179]">Due {formatOwnerDate(currentRound.dueDate)}</p>
          </div>
        ) : nextRound ? (
          <div>
            <p className="text-sm leading-6 text-[#587066]">No round is currently active.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Next round</span>
              <Badge {...getRoundStatusBadge(nextRound.status)} />
              <p className="text-sm text-[#173b32]">
                Round {nextRound.roundNumber} · {nextRound.recipientDisplayName}{" "}
                <span className="text-xs text-[#7b8179]">({nextRound.recipientMemberCode})</span>
              </p>
              <p className="text-xs text-[#7b8179]">Due {formatOwnerDate(nextRound.dueDate)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-6 text-[#587066]">No round is currently active or upcoming.</p>
        )}
        <p className="mt-4 text-xs leading-5 text-[#7b8179]">
          {closedRoundCount} of {totalRoundCount} rounds closed. Rounds existing here means the rotation was
          generated at activation -- it does not mean any contribution has been collected or any payout made.
        </p>
      </Card>

      <Card title="Members, in payout order">
        <ol className="divide-y divide-[#efe6d8]">
          {members.map((member) => (
            <li key={member.id} className="py-2 text-sm text-[#173b32]">
              <span className="font-semibold">{member.payoutOrder}.</span> {member.displayName}{" "}
              <span className="text-xs text-[#7b8179]">({member.memberCode})</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Full rotation schedule">
        <ol className="divide-y divide-[#efe6d8]">
          {rounds.map((round) => {
            const status = getRoundStatusBadge(round.status);
            return (
              <li
                key={round.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-[#173b32]">
                    Round {round.roundNumber} · {round.recipientDisplayName}
                  </p>
                  <p className="text-xs text-[#7b8179]">
                    ({round.recipientMemberCode}) · Due {formatOwnerDate(round.dueDate)}
                  </p>
                </div>
                <Badge {...status} />
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
