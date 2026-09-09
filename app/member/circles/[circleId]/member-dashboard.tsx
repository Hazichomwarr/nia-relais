import type { MemberDashboardResult } from "@/src/services/circle-member-dashboard.service";

import {
  formatCircleDate,
  formatCircleDateTime,
  formatCircleMoney,
  getCircleStatusLabel,
  getFrequencyLabel,
  getObligationStatusPresentation,
  getPayoutPresentation,
  getRoundStatusPresentation,
  isMemberRecipientRound,
  selectRoundHeading,
} from "./member-dashboard-display";

// Read-only presentation only -- this component receives an already
// authorized, already-serialized MemberDashboardResult as a prop and
// performs no data fetching, no mutation, and no client-side interactivity
// of its own (no "use client", no confirmation button, no form). Every
// financial figure rendered here is a string the 7H.2 service already
// computed with Decimal arithmetic; nothing here re-parses or
// recalculates one.

export function MemberDashboard({ dashboard }: { dashboard: MemberDashboardResult }) {
  const roundHeading = selectRoundHeading(dashboard);

  return (
    <main className="min-h-screen bg-[#fbf7ef] px-5 py-10 text-[#173b32] sm:px-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">
            SUSU circle member
          </p>
          <h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">{dashboard.circle.name}</h1>
          <p className="mt-2 text-sm text-[#587066]">
            Signed in as <span className="font-semibold text-[#173b32]">{dashboard.member.displayName}</span>
          </p>
        </header>

        <CircleSummaryCard dashboard={dashboard} />
        <CurrentRoundCard dashboard={dashboard} roundHeading={roundHeading} />
        <MyContributionsCard dashboard={dashboard} />
        <MyPayoutCard dashboard={dashboard} />
        <RotationScheduleCard dashboard={dashboard} />
      </div>
    </main>
  );
}

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

function CircleSummaryCard({ dashboard }: { dashboard: MemberDashboardResult }) {
  const { circle } = dashboard;

  return (
    <Card title="Circle terms">
      <DetailList>
        <DetailRow
          label="Contribution"
          value={`${formatCircleMoney(circle.contributionAmount, circle.currency)} · ${getFrequencyLabel(circle.frequency)}`}
        />
        <DetailRow label="Started" value={formatCircleDate(circle.startDate)} />
        <DetailRow label="Status" value={<Badge {...getCircleStatusBadge(circle.status)} />} />
      </DetailList>
      <p className="mt-5 text-sm leading-6 text-[#587066]">
        NIA tracks this circle&apos;s contributions and payouts as a shared ledger. It does not hold or
        transfer money on anyone&apos;s behalf.
      </p>
    </Card>
  );
}

// The circle's own lifecycle status reuses the same neutral/positive badge
// language as round status, but circle status has its own label set
// (ACTIVE/COMPLETED/ARCHIVED/etc. rather than UPCOMING/ACTIVE/CLOSED).
function getCircleStatusBadge(status: string) {
  const label = getCircleStatusLabel(status);
  const className = status === "ACTIVE" ? "bg-[#e6f0e8] text-[#35634f]" : "bg-[#efe7db] text-[#587066]";
  return { label, className };
}

function CurrentRoundCard({
  dashboard,
  roundHeading,
}: {
  dashboard: MemberDashboardResult;
  roundHeading: ReturnType<typeof selectRoundHeading>;
}) {
  if (roundHeading.kind === "historical") {
    return (
      <Card title="Rotation complete">
        <p className="text-sm leading-6 text-[#587066]">
          {dashboard.circle.status === "COMPLETED"
            ? "This circle has completed its full rotation. Your activity below reflects its final state."
            : "This circle has been archived. Your activity below reflects its final state."}
        </p>
      </Card>
    );
  }

  if (roundHeading.kind === "none") {
    return (
      <Card title="Rotation">
        <p className="text-sm leading-6 text-[#587066]">There is no round to show yet.</p>
      </Card>
    );
  }

  const { round } = roundHeading;
  const statusBadge = getRoundStatusPresentation(round.status);

  return (
    <Card title={roundHeading.kind === "current" ? "Current round" : "Next round"}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge {...statusBadge} />
        <span className="text-sm text-[#587066]">Round {round.roundNumber}</span>
      </div>
      <DetailList>
        <DetailRow label="Due" value={formatCircleDate(round.dueDate)} />
        <DetailRow label="Recipient" value={round.recipientDisplayName} />
      </DetailList>
      {dashboard.roundProgress ? (
        <p className="mt-4 text-sm text-[#587066]">
          {dashboard.roundProgress.confirmedMemberCount} of {dashboard.roundProgress.totalMemberCount} members have
          confirmed their contribution for this round.
        </p>
      ) : null}
    </Card>
  );
}

function MyContributionsCard({ dashboard }: { dashboard: MemberDashboardResult }) {
  const { summary, obligations, circle } = dashboard;

  return (
    <Card title="My contributions">
      <DetailList>
        <DetailRow
          label="Confirmed so far"
          value={formatCircleMoney(summary.confirmedContributionTotal, circle.currency)}
        />
        <DetailRow
          label="Rounds fulfilled"
          value={`${summary.fulfilledObligationCount} of ${summary.totalObligationCount}`}
        />
      </DetailList>

      {obligations.length === 0 ? (
        <p className="mt-5 text-sm text-[#587066]">You have no contribution rounds yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-[#efe6d8]">
          {obligations.map((obligation) => {
            const status = getObligationStatusPresentation(obligation);
            return (
              <li key={obligation.roundNumber} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#173b32]">Round {obligation.roundNumber}</p>
                  <p className="text-xs text-[#7b8179]">Due {formatCircleDate(obligation.dueDate)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  <span className="text-sm text-[#587066]">
                    {formatCircleMoney(obligation.confirmedAmount, circle.currency)} confirmed of{" "}
                    {formatCircleMoney(obligation.expectedAmount, circle.currency)}
                  </span>
                  {!obligation.fulfilled ? (
                    <span className="text-sm text-[#8a5b27]">
                      {formatCircleMoney(obligation.outstandingAmount, circle.currency)} outstanding
                    </span>
                  ) : null}
                  <Badge {...status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function MyPayoutCard({ dashboard }: { dashboard: MemberDashboardResult }) {
  const { payout, circle } = dashboard;
  const presentation = getPayoutPresentation(payout);

  return (
    <Card title="My payout">
      <div className="flex flex-wrap items-center gap-3">
        <Badge label={presentation.label} className={presentation.className} />
        {payout ? <span className="text-sm text-[#587066]">Round {payout.roundNumber}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-[#587066]">{presentation.description}</p>

      {payout ? (
        <DetailList>
          <DetailRow label="Amount" value={formatCircleMoney(payout.amount, circle.currency)} />
          <DetailRow label="Recorded" value={formatCircleDateTime(payout.recordedAt)} />
          {payout.confirmedAt ? <DetailRow label="Confirmed" value={formatCircleDateTime(payout.confirmedAt)} /> : null}
          {payout.disputedAt ? <DetailRow label="Disputed" value={formatCircleDateTime(payout.disputedAt)} /> : null}
        </DetailList>
      ) : null}
    </Card>
  );
}

function RotationScheduleCard({ dashboard }: { dashboard: MemberDashboardResult }) {
  return (
    <Card title="Full rotation schedule">
      <ol className="divide-y divide-[#efe6d8]">
        {dashboard.roundSchedule.map((round) => {
          const isOwnRound = isMemberRecipientRound(round, dashboard.member.payoutOrder);
          const status = getRoundStatusPresentation(round.status);

          return (
            <li
              key={round.roundNumber}
              className={`flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between ${isOwnRound ? "rounded-2xl bg-[#fff4e9] px-3" : ""}`}
            >
              <div>
                <p className="text-sm font-semibold text-[#173b32]">
                  Round {round.roundNumber}
                  {isOwnRound ? <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-[#a95f45]">Your round</span> : null}
                </p>
                <p className="text-xs text-[#7b8179]">
                  Due {formatCircleDate(round.dueDate)} · Recipient: {round.recipientDisplayName}
                </p>
              </div>
              <Badge {...status} />
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
