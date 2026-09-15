import type { MemberDashboardResult } from "@/src/services/circle-member-dashboard.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

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

export function MemberDashboard({
  dashboard,
  dictionary,
  locale,
  children,
}: {
  dashboard: MemberDashboardResult;
  dictionary: Dictionary;
  locale: Locale;
  // Additive slot only (7K.10): the richer recipient payout card
  // (member-payout-card.tsx, backed by getCircleMemberPayouts, 7K.8) is
  // composed in here by the page rather than this component reaching out
  // to fetch or import it itself -- this file's own data dependency
  // remains exactly MemberDashboardResult, unchanged. Rendered after
  // every existing card, never in place of MyPayoutCard below (which is
  // left completely unmodified, per 7K.10's own "additive, not a
  // rewrite" instruction).
  children?: React.ReactNode;
}) {
  const roundHeading = selectRoundHeading(dashboard);
  const copy = dictionary.memberWorkspace;

  return (
    <main className="min-h-screen bg-[#fbf7ef] px-5 py-10 text-[#173b32] sm:px-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">{dashboard.circle.name}</h1>
          <p className="mt-2 text-sm text-[#587066]">
            {copy.signedInAs} <span className="font-semibold text-[#173b32]">{dashboard.member.displayName}</span>
          </p>
        </header>

        <CircleSummaryCard dashboard={dashboard} dictionary={dictionary} locale={locale} />
        {dashboard.circle.originKind === "IMPORTED" ? (
          <section className="rounded-2xl border border-[#dbe2d6] bg-[#eef1ea] p-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex w-fit rounded-full bg-[#e3e8df] px-3 py-1 text-xs font-semibold text-[#4f6354]">
                {copy.importedCircleContextTitle}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[#4f6354]">
              {copy.importedCircleContextDescription.replace("{count}", String(dashboard.circle.historicalCompletedRoundCount))}
            </p>
          </section>
        ) : null}
        <CurrentRoundCard dashboard={dashboard} roundHeading={roundHeading} dictionary={dictionary} locale={locale} />
        <MyContributionsCard dashboard={dashboard} dictionary={dictionary} locale={locale} />
        <MyPayoutCard dashboard={dashboard} dictionary={dictionary} locale={locale} />
        <RotationScheduleCard dashboard={dashboard} dictionary={dictionary} locale={locale} />
        {children}
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

function CircleSummaryCard({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const { circle } = dashboard;
  const copy = dictionary.memberWorkspace;

  return (
    <Card title={copy.circleTerms}>
      <DetailList>
        <DetailRow
          label={copy.contribution}
          value={`${formatCircleMoney(circle.contributionAmount, circle.currency)} · ${getFrequencyLabel(circle.frequency, locale)}`}
        />
        <DetailRow label={copy.started} value={formatCircleDate(circle.startDate, locale)} />
        <DetailRow label={copy.status} value={<Badge label={circle.status === "ACTIVE" ? dictionary.susuFinancial.active : circle.status === "COMPLETED" ? dictionary.susuWorkspace.completed : circle.status} className={getCircleStatusBadge(circle.status).className} />} />
      </DetailList>
      <p className="mt-5 text-sm leading-6 text-[#587066]">
        {copy.ledgerDescription}
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
  dictionary,
  locale,
}: {
  dashboard: MemberDashboardResult;
  roundHeading: ReturnType<typeof selectRoundHeading>;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.memberWorkspace;
  if (roundHeading.kind === "historical") {
    return (
      <Card title={copy.rotationComplete}>
        <p className="text-sm leading-6 text-[#587066]">
          {dashboard.circle.status === "COMPLETED"
            ? copy.completedDescription
            : copy.archivedDescription}
        </p>
      </Card>
    );
  }

  if (roundHeading.kind === "none") {
    return (
      <Card title={copy.rotation}>
        <p className="text-sm leading-6 text-[#587066]">{copy.noRound}</p>
      </Card>
    );
  }

  const { round } = roundHeading;
  const statusBadge = getRoundStatusPresentation(round.status, round.closureBasis);
  const statusLabel =
    round.closureBasis === "IMPORTED_DECLARATION"
      ? dictionary.susuFinancial.importedHistory
      : round.status === "ACTIVE"
        ? dictionary.susuFinancial.active
        : round.status === "CLOSED"
          ? dictionary.susuFinancial.closed
          : dictionary.susuFinancial.upcoming;
  const awaitingFirstLiveRound = dashboard.circle.originKind === "IMPORTED" && dashboard.currentRound === null;

  return (
    <Card title={roundHeading.kind === "current" ? copy.currentRound : copy.nextRound}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge label={statusLabel} className={statusBadge.className} />
        <span className="text-sm text-[#587066]">{copy.round} {round.roundNumber}</span>
      </div>
      <DetailList>
        <DetailRow label={copy.due} value={formatCircleDate(round.dueDate, locale)} />
        <DetailRow label={copy.recipient} value={round.recipientDisplayName} />
      </DetailList>
      {dashboard.roundProgress ? (
        <p className="mt-4 text-sm text-[#587066]">
          {copy.progress.replace("{confirmed}", String(dashboard.roundProgress.confirmedMemberCount)).replace("{total}", String(dashboard.roundProgress.totalMemberCount))}
        </p>
      ) : null}
      {awaitingFirstLiveRound ? (
        <p className="mt-4 text-xs leading-5 text-[#7b8179]">{copy.awaitingFirstLiveRound}</p>
      ) : null}
    </Card>
  );
}

function MyContributionsCard({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const { summary, obligations, circle } = dashboard;
  const copy = dictionary.memberWorkspace;

  return (
    <Card title={copy.myContributions}>
      <DetailList>
        <DetailRow
          label={copy.confirmedSoFar}
          value={formatCircleMoney(summary.confirmedContributionTotal, circle.currency)}
        />
        <DetailRow
          label={copy.roundsFulfilled}
          value={`${summary.fulfilledObligationCount} of ${summary.totalObligationCount}`}
        />
      </DetailList>

      {obligations.length === 0 ? (
        <p className="mt-5 text-sm text-[#587066]">{copy.noContributions}</p>
      ) : (
        <ul className="mt-5 divide-y divide-[#efe6d8]">
          {obligations.map((obligation) => {
            const status = getObligationStatusPresentation(obligation);
            const isImported = obligation.fulfillmentBasis === "IMPORTED_DECLARATION";
            const label = isImported
              ? dictionary.susuFinancial.importedHistory
              : obligation.fulfilled
                ? dictionary.susuFinancial.fulfilled
                : dictionary.susuFinancial.outstanding;
            return (
              <li key={obligation.roundNumber} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#173b32]">{copy.round} {obligation.roundNumber}</p>
                  <p className="text-xs text-[#7b8179]">{copy.due} {formatCircleDate(obligation.dueDate, locale)}</p>
                  {isImported ? (
                    <p className="mt-1 text-xs leading-5 text-[#7b8179]">{dictionary.susuFinancial.importedHistoryDescription}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {!isImported ? (
                    <span className="text-sm text-[#587066]">
                      {formatCircleMoney(obligation.confirmedAmount, circle.currency)} {copy.confirmedOf}{" "}
                      {formatCircleMoney(obligation.expectedAmount, circle.currency)}
                    </span>
                  ) : null}
                  {!isImported && !obligation.fulfilled ? (
                    <span className="text-sm text-[#8a5b27]">
                      {formatCircleMoney(obligation.outstandingAmount, circle.currency)} {copy.outstanding}
                    </span>
                  ) : null}
                  <Badge label={label} className={status.className} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function MyPayoutCard({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const { payout, circle } = dashboard;
  const presentation = getPayoutPresentation(payout);
  const copy = dictionary.memberWorkspace;
  const isImported = payout !== null && payout.confirmationBasis === "IMPORTED_DECLARATION";
  const payoutCopy = isImported
    ? { label: dictionary.susuFinancial.importedHistory, description: dictionary.susuFinancial.importedHistoryDescription }
    : payout === null
      ? { label: copy.payoutNotRecorded, description: copy.payoutNotRecordedDescription }
      : payout.status === "RECORDED"
        ? { label: copy.payoutAwaitingDecision, description: copy.payoutAwaitingDecisionDescription }
        : payout.status === "CONFIRMED"
          ? { label: copy.payoutConfirmed, description: copy.payoutConfirmedDescription }
          : { label: copy.payoutDisputed, description: copy.payoutDisputedDescription };

  return (
    <Card title={copy.myPayout}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge label={payoutCopy.label} className={presentation.className} />
        {payout ? <span className="text-sm text-[#587066]">{copy.round} {payout.roundNumber}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-[#587066]">{payoutCopy.description}</p>

      {payout ? (
        <DetailList>
          <DetailRow label={copy.amount} value={formatCircleMoney(payout.amount, circle.currency)} />
          {!isImported ? <DetailRow label={copy.recorded} value={formatCircleDateTime(payout.recordedAt, locale)} /> : null}
          {!isImported && payout.confirmedAt ? <DetailRow label={copy.confirmed} value={formatCircleDateTime(payout.confirmedAt, locale)} /> : null}
          {payout.disputedAt ? <DetailRow label={copy.disputed} value={formatCircleDateTime(payout.disputedAt, locale)} /> : null}
        </DetailList>
      ) : null}
    </Card>
  );
}

function RotationScheduleCard({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  return (
    <Card title={copy.fullSchedule}>
      <ol className="divide-y divide-[#efe6d8]">
        {dashboard.roundSchedule.map((round) => {
          const isOwnRound = isMemberRecipientRound(round, dashboard.member.payoutOrder);
          const status = getRoundStatusPresentation(round.status, round.closureBasis);
          const label =
            round.closureBasis === "IMPORTED_DECLARATION"
              ? dictionary.susuFinancial.importedHistory
              : round.status === "ACTIVE"
                ? dictionary.susuFinancial.active
                : round.status === "CLOSED"
                  ? dictionary.susuFinancial.closed
                  : dictionary.susuFinancial.upcoming;

          return (
            <li
              key={round.roundNumber}
              className={`flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between ${isOwnRound ? "rounded-2xl bg-[#fff4e9] px-3" : ""}`}
            >
              <div>
                <p className="text-sm font-semibold text-[#173b32]">
                  {copy.round} {round.roundNumber}
                  {isOwnRound ? <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-[#a95f45]">{copy.yourRound}</span> : null}
                </p>
                <p className="text-xs text-[#7b8179]">
                  {copy.due} {formatCircleDate(round.dueDate, locale)} · {copy.recipient}: {round.recipientDisplayName}
                </p>
              </div>
              <Badge label={label} className={status.className} />
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
