import type { ActiveCircleOwnerSummaryResult } from "@/src/services/circle-active-owner.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

import { getFrequencyLabel } from "@/src/i18n/format";
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

export function ActiveCircleSummary({ summary, dictionary, locale }: { summary: ActiveCircleOwnerSummaryResult; dictionary: Dictionary; locale: Locale }) {
  const { circle, members, rounds, currentRound, nextRound, totalRoundCount, closedRoundCount } = summary;
  const copy = dictionary.susuOwner;
  const financial = dictionary.susuFinancial;
  const isImported = circle.originKind === "IMPORTED";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{copy.circlesEyebrow}</p>
        <span className="mt-3 inline-flex w-fit rounded-full bg-[#e6f0e8] px-3 py-1 text-sm font-semibold text-[#35634f]">
          {financial.active}
        </span>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{circle.name}</h1>
        <p className="mt-4 max-w-xl leading-7 text-[#587066]">
          {copy.activeCircleDescription}
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.contribution}</dt>
            <dd className="mt-1 text-base text-[#173b32]">
              {circle.currency} {circle.contributionAmount} · {getFrequencyLabel(circle.frequency, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.started}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.activated}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.activatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.members}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{members.length}</dd>
          </div>
        </dl>
      </section>

      {isImported ? (
        <section className="rounded-2xl border border-[#dbe2d6] bg-[#eef1ea] p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex w-fit rounded-full bg-[#e3e8df] px-3 py-1 text-xs font-semibold text-[#4f6354]">
              {copy.importedCircleContextTitle}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#4f6354]">
            {copy.importedCircleContextDescription.replace("{count}", String(circle.historicalCompletedRoundCount))}
          </p>
        </section>
      ) : null}

      <Card title={copy.currentRound}>
        {currentRound ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              label={
                currentRound.closureBasis === "IMPORTED_DECLARATION"
                  ? financial.importedHistory
                  : currentRound.status === "ACTIVE"
                    ? financial.active
                    : currentRound.status === "CLOSED"
                      ? financial.closed
                      : financial.upcoming
              }
              className={getRoundStatusBadge(currentRound.status, currentRound.closureBasis).className}
            />
            <p className="text-sm text-[#173b32]">
              {financial.round} {currentRound.roundNumber} · {currentRound.recipientDisplayName}{" "}
              <span className="text-xs text-[#7b8179]">({currentRound.recipientMemberCode})</span>
            </p>
            <p className="text-xs text-[#7b8179]">{copy.due} {formatOwnerDate(currentRound.dueDate)}</p>
          </div>
        ) : nextRound ? (
          <div>
            <p className="text-sm leading-6 text-[#587066]">{copy.noActiveRound}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.nextRound}</span>
              <Badge
                label={
                  nextRound.closureBasis === "IMPORTED_DECLARATION"
                    ? financial.importedHistory
                    : nextRound.status === "ACTIVE"
                      ? financial.active
                      : nextRound.status === "CLOSED"
                        ? financial.closed
                        : financial.upcoming
                }
                className={getRoundStatusBadge(nextRound.status, nextRound.closureBasis).className}
              />
              <p className="text-sm text-[#173b32]">
                {financial.round} {nextRound.roundNumber} · {nextRound.recipientDisplayName}{" "}
                <span className="text-xs text-[#7b8179]">({nextRound.recipientMemberCode})</span>
              </p>
              <p className="text-xs text-[#7b8179]">{copy.due} {formatOwnerDate(nextRound.dueDate)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-6 text-[#587066]">{copy.noRoundAvailable}</p>
        )}
        <p className="mt-4 text-xs leading-5 text-[#7b8179]">
          {copy.rotationProgress.replace("{closed}", String(closedRoundCount)).replace("{total}", String(totalRoundCount))}
        </p>
      </Card>

      <Card title={`${copy.members}, ${copy.payoutOrder.toLocaleLowerCase()}`}>
        <ol className="divide-y divide-[#efe6d8]">
          {members.map((member) => (
            <li key={member.id} className="py-2 text-sm text-[#173b32]">
              <span className="font-semibold">{member.payoutOrder}.</span> {member.displayName}{" "}
              {member.phone ? <span className="ml-2 text-xs text-[#7b8179]">{dictionary.susu.phoneNumber}: {member.phone}</span> : null}
            </li>
          ))}
        </ol>
      </Card>

      <Card title={copy.fullSchedule}>
        <ol className="divide-y divide-[#efe6d8]">
          {rounds.map((round) => {
            const status = getRoundStatusBadge(round.status, round.closureBasis);
            const label =
              round.closureBasis === "IMPORTED_DECLARATION"
                ? financial.importedHistory
                : round.status === "ACTIVE"
                  ? financial.active
                  : round.status === "CLOSED"
                    ? financial.closed
                    : financial.upcoming;
            return (
              <li
                key={round.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-[#173b32]">
                    {financial.round} {round.roundNumber} · {round.recipientDisplayName}
                  </p>
                  <p className="text-xs text-[#7b8179]">
                    {copy.due} {formatOwnerDate(round.dueDate)}
                  </p>
                </div>
                <Badge label={label} className={status.className} />
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
