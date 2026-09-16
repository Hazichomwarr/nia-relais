import Image from "next/image";

import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import type { MemberDashboardResult, MemberObligationResult, RoundScheduleEntry } from "@/src/services/circle-member-dashboard.service";

import {
  formatCircleDate,
  formatCircleMoney,
  getFrequencyLabel,
  getObligationStatusPresentation,
  getRoundStatusPresentation,
  isMemberRecipientRound,
  selectRoundHeading,
} from "./member-dashboard-display";

// The member workspace is a server-rendered, read-only composition. Its
// authorized read model is complete before it reaches this component; this
// presentation does not add any mutation, lifecycle, or client-side fetch.
export function MemberDashboard({
  dashboard,
  dictionary,
  locale,
  payoutPanel,
}: {
  dashboard: MemberDashboardResult;
  dictionary: Dictionary;
  locale: Locale;
  payoutPanel?: React.ReactNode;
}) {
  const roundHeading = selectRoundHeading(dashboard);
  const currentRoundBelongsToMember =
    roundHeading.kind === "current" && isMemberRecipientRound(roundHeading.round, dashboard.member.payoutOrder);

  return (
    <main id="member-workspace" className="min-h-screen bg-[#fbf7ef] px-4 py-5 text-[#173b32] sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-5xl pb-24 sm:pb-10">
        <WorkspaceHeader dashboard={dashboard} dictionary={dictionary} locale={locale} />
        <MemberIdentity dashboard={dashboard} dictionary={dictionary} locale={locale} />
        {dashboard.circle.originKind === "IMPORTED" ? <ImportedHistoryNotice dashboard={dashboard} dictionary={dictionary} /> : null}
        <RoundHero dashboard={dashboard} roundHeading={roundHeading} dictionary={dictionary} locale={locale} />
        {currentRoundBelongsToMember ? payoutPanel : null}
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <ContributionCard dashboard={dashboard} roundHeading={roundHeading} dictionary={dictionary} locale={locale} />
          <CircleFacts dashboard={dashboard} dictionary={dictionary} locale={locale} />
        </div>
        <SecondaryInformation dashboard={dashboard} dictionary={dictionary} locale={locale} payoutPanel={currentRoundBelongsToMember ? null : payoutPanel} />
      </div>
      <BottomNavigation dictionary={dictionary} />
    </main>
  );
}

function WorkspaceHeader({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Image src="/images/nia-logo.png" width={42} height={42} priority alt="NIA" className="size-10 shrink-0 object-contain" />
        <div className="min-w-0 leading-none">
          <p className="font-serif text-xl font-semibold tracking-[0.12em] text-[#173b32]">NIA</p>
          <p className="mt-1 text-[0.625rem] font-medium tracking-wide text-[#587066]">{dictionary.memberWorkspace.poweredByRelais}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <LanguageSwitcher locale={locale} languageLabel={dictionary.common.language} compact />
        <span aria-label={dashboard.member.displayName} className="inline-flex size-10 items-center justify-center rounded-full bg-[#efe1cf] text-sm font-bold text-[#315b4b]">{initials(dashboard.member.displayName)}</span>
      </div>
    </header>
  );
}

function MemberIdentity({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  return (
    <section className="mt-8 sm:mt-10">
      <p className="font-serif text-3xl leading-[1.02] tracking-tight sm:text-4xl">{copy.welcomeBack}</p>
      <h1 className="mt-1 break-words font-serif text-4xl leading-[1.02] tracking-tight text-[#173b32] sm:text-5xl">{dashboard.member.displayName}</h1>
      <p className="mt-4 break-words text-lg font-semibold text-[#315b4b]">{dashboard.circle.name}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-[#587066]">
        <span>{copy.susuCircle}</span><span aria-hidden="true">·</span><span>{dashboard.activeMemberCount} {copy.members}</span><span aria-hidden="true">·</span><span>{getFrequencyLabel(dashboard.circle.frequency, locale)}</span><span aria-hidden="true">·</span><span className="inline-flex items-center gap-1.5 font-medium text-[#35634f]"><span aria-hidden="true" className="size-2 rounded-full bg-[#23a460]" />{circleStatusLabel(dashboard.circle.status, dictionary)}</span>
      </p>
    </section>
  );
}

function ImportedHistoryNotice({ dashboard, dictionary }: { dashboard: MemberDashboardResult; dictionary: Dictionary }) {
  const copy = dictionary.memberWorkspace;
  return <section className="mt-5 rounded-2xl border border-[#d6e0d3] bg-[#eef4ec] px-4 py-3 text-sm leading-6 text-[#4f6354]"><p className="font-semibold">{copy.importedCircleContextTitle}</p><p className="mt-1">{copy.importedCircleContextDescription.replace("{count}", String(dashboard.circle.historicalCompletedRoundCount))}</p></section>;
}

function RoundHero({ dashboard, roundHeading, dictionary, locale }: { dashboard: MemberDashboardResult; roundHeading: ReturnType<typeof selectRoundHeading>; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  if (roundHeading.kind === "historical") return <HeroFrame eyebrow={copy.rotationComplete}><p className="mt-4 max-w-xl text-sm leading-6 text-[#587066]">{dashboard.circle.status === "COMPLETED" ? copy.completedDescription : copy.archivedDescription}</p></HeroFrame>;
  if (roundHeading.kind === "none") return <HeroFrame eyebrow={copy.rotation}><p className="mt-4 text-sm leading-6 text-[#587066]">{dashboard.circle.originKind === "IMPORTED" ? copy.awaitingFirstLiveRound : copy.noRound}</p></HeroFrame>;

  const { round } = roundHeading;
  const recipientIsMember = isMemberRecipientRound(round, dashboard.member.payoutOrder);
  const status = getRoundStatusPresentation(round.status, round.closureBasis);
  const heading = recipientIsMember ? copy.youReceiveThisRound : copy.recipientReceivesThisRound.replace("{name}", round.recipientDisplayName);
  const roundLabel = roundHeading.kind === "current" ? copy.currentRound : copy.nextRound;

  return (
    <HeroFrame eyebrow={`${copy.round} ${round.roundNumber}`}>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><p className="max-w-xl break-words font-serif text-3xl leading-[1.04] tracking-tight text-[#174337] sm:text-4xl">{heading}</p><p className="mt-2 font-serif text-3xl leading-none tracking-tight text-[#ad4c2a] sm:text-4xl">{formatCircleMoney(dashboard.roundProgress?.expectedPayoutAmount ?? dashboard.circle.contributionAmount, dashboard.circle.currency)}</p></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end"><Badge label={round.closureBasis === "IMPORTED_DECLARATION" ? copy.importedHistory : roundLabel} className={status.className} /><p className="text-sm font-medium text-[#315b4b]">{copy.due} {formatCircleDate(round.dueDate, locale)}</p></div>
      </div>
      {dashboard.roundProgress ? <Progress progress={dashboard.roundProgress} dictionary={dictionary} /> : null}
    </HeroFrame>
  );
}

function HeroFrame({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return <section className="mt-6 rounded-[1.7rem] border border-[#eed9ca] bg-[#fff5ec] p-5 shadow-[0_12px_32px_rgba(116,75,43,0.06)] sm:mt-8 sm:p-7"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ad4c2a]">{eyebrow}</p>{children}</section>;
}

function Progress({ progress, dictionary }: { progress: NonNullable<MemberDashboardResult["roundProgress"]>; dictionary: Dictionary }) {
  const percentage = progress.totalMemberCount === 0 ? 0 : Math.round((progress.confirmedMemberCount / progress.totalMemberCount) * 100);
  return <div className="mt-6"><p className="text-sm font-medium text-[#315b4b]">{dictionary.memberWorkspace.contributionProgress.replace("{confirmed}", String(progress.confirmedMemberCount)).replace("{total}", String(progress.totalMemberCount))}</p><div className="mt-2 flex items-center gap-3"><div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e5dfd7]"><div className="h-full rounded-full bg-[#4d8a6d]" style={{ width: `${percentage}%` }} /></div><span className="text-sm font-semibold text-[#315b4b]">{percentage}%</span></div></div>;
}

function ContributionCard({ dashboard, roundHeading, dictionary, locale }: { dashboard: MemberDashboardResult; roundHeading: ReturnType<typeof selectRoundHeading>; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  const round = roundHeading.kind === "current" || roundHeading.kind === "next" ? roundHeading.round : null;
  const obligation = round ? dashboard.obligations.find((item) => item.roundNumber === round.roundNumber) : null;
  const imported = obligation?.fulfillmentBasis === "IMPORTED_DECLARATION";
  const presentation = obligation ? getObligationStatusPresentation(obligation) : null;
  const label = !obligation ? copy.noContributions : imported ? copy.importedHistory : obligation.fulfilled ? copy.confirmedContribution : copy.outstanding;
  return <section className="rounded-[1.5rem] border border-[#e5ddd2] bg-[#fffdf9] p-5 shadow-[0_8px_24px_rgba(77,57,40,0.045)] sm:p-6"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-serif text-2xl tracking-tight">{copy.contribution}</p>{round ? <p className="mt-1 text-sm text-[#587066]">{copy.thisRound} · {copy.due} {formatCircleDate(round.dueDate, locale)}</p> : null}</div>{presentation ? <Badge label={label} className={presentation.className} /> : null}</div>{obligation ? <><p className="mt-4 font-serif text-3xl leading-none tracking-tight text-[#ad4c2a]">{formatCircleMoney(obligation.expectedAmount, dashboard.circle.currency)}</p>{imported ? <p className="mt-3 text-xs leading-5 text-[#587066]">{copy.importedHistoryDescription}</p> : obligation.fulfilled ? <p className="mt-3 text-sm text-[#587066]">{formatCircleMoney(obligation.confirmedAmount, dashboard.circle.currency)} {copy.confirmedOf} {formatCircleMoney(obligation.expectedAmount, dashboard.circle.currency)}</p> : <p className="mt-3 text-sm text-[#8a5b27]">{formatCircleMoney(obligation.outstandingAmount, dashboard.circle.currency)} {copy.outstanding}</p>}</> : <p className="mt-4 text-sm leading-6 text-[#587066]">{copy.noContributions}</p>}</section>;
}

function CircleFacts({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  return <section className="grid grid-cols-3 divide-x divide-[#e6ddd3] rounded-[1.5rem] border border-[#e5ddd2] bg-[#fffdf9] py-4 shadow-[0_8px_24px_rgba(77,57,40,0.045)]"><Fact value={String(dashboard.activeMemberCount)} label={copy.members} /><Fact value={getFrequencyLabel(dashboard.circle.frequency, locale)} label={copy.contributionFrequency} compact /><Fact value={String(dashboard.roundSchedule.length)} label={copy.totalRounds} /></section>;
}

function Fact({ value, label, compact = false }: { value: string; label: string; compact?: boolean }) {
  return <div className="min-w-0 px-3 text-center"><p className={`break-words font-serif leading-tight text-[#173b32] ${compact ? "text-base sm:text-lg" : "text-2xl sm:text-3xl"}`}>{value}</p><p className="mt-1 text-xs leading-4 text-[#587066]">{label}</p></div>;
}

function SecondaryInformation({ dashboard, dictionary, locale, payoutPanel }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale; payoutPanel?: React.ReactNode }) {
  const copy = dictionary.memberWorkspace;
  return <section className="mt-5 overflow-hidden rounded-[1.5rem] border border-[#e5ddd2] bg-[#fffdf9] shadow-[0_8px_24px_rgba(77,57,40,0.045)]"><Disclosure id="rotation-schedule" icon="calendar" title={copy.fullSchedule} description={copy.scheduleDescription}><RotationSchedule dashboard={dashboard} dictionary={dictionary} locale={locale} /></Disclosure><Disclosure id="contribution-history" icon="list" title={copy.myContributions} description={copy.contributionHistoryDescription}><ContributionHistory obligations={dashboard.obligations} currency={dashboard.circle.currency} dictionary={dictionary} locale={locale} />{payoutPanel}</Disclosure><Disclosure id="circle-members" icon="people" title={copy.members} description={copy.membersDescription}><ul className="grid gap-2 sm:grid-cols-2">{dashboard.activeMemberDisplayNames.map((name, index) => <li key={`${name}-${index}`} className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-[#315b4b]">{name}</li>)}</ul></Disclosure><Disclosure id="circle-details" icon="document" title={copy.circleDetails} description={copy.circleDetailsDescription}><dl className="grid gap-4 sm:grid-cols-3"><Detail label={copy.contribution} value={formatCircleMoney(dashboard.circle.contributionAmount, dashboard.circle.currency)} /><Detail label={copy.contributionFrequency} value={getFrequencyLabel(dashboard.circle.frequency, locale)} /><Detail label={copy.started} value={formatCircleDate(dashboard.circle.startDate, locale)} /></dl><p className="mt-5 text-sm leading-6 text-[#587066]">{copy.ledgerDescription}</p></Disclosure></section>;
}

function Disclosure({ id, icon, title, description, children }: { id: string; icon: IconName; title: string; description: string; children: React.ReactNode }) {
  return <details id={id} className="group border-b border-[#eee7de] last:border-b-0"><summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:content-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#b96549]"><Icon name={icon} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#173b32]">{title}</span><span className="mt-0.5 block text-sm leading-5 text-[#587066]">{description}</span></span><span aria-hidden="true" className="text-2xl leading-none text-[#71857c] transition group-open:rotate-90">›</span></summary><div className="border-t border-[#eee7de] bg-[#fcfaf5] px-5 py-4">{children}</div></details>;
}

function RotationSchedule({ dashboard, dictionary, locale }: { dashboard: MemberDashboardResult; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  return <ol className="divide-y divide-[#ebe3d9]">{dashboard.roundSchedule.map((round) => <li key={round.roundNumber} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f3ede3] text-xs font-bold text-[#587066]">{round.roundNumber}</span><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{round.recipientDisplayName}</p><p className="mt-0.5 text-xs text-[#587066]">{copy.due} {formatCircleDate(round.dueDate, locale)}</p></div><Badge label={round.closureBasis === "IMPORTED_DECLARATION" ? copy.importedHistory : roundStatusLabel(round, dictionary)} className={getRoundStatusPresentation(round.status, round.closureBasis).className} /></li>)}</ol>;
}

function ContributionHistory({ obligations, currency, dictionary, locale }: { obligations: readonly MemberObligationResult[]; currency: string; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.memberWorkspace;
  if (obligations.length === 0) return <p className="text-sm text-[#587066]">{copy.noContributions}</p>;
  return <ul className="divide-y divide-[#ebe3d9]">{obligations.map((obligation) => { const imported = obligation.fulfillmentBasis === "IMPORTED_DECLARATION"; const status = getObligationStatusPresentation(obligation); const label = imported ? copy.importedHistory : obligation.fulfilled ? copy.confirmedContribution : copy.outstanding; return <li key={obligation.roundNumber} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{copy.round} {obligation.roundNumber}</p><p className="mt-0.5 text-xs text-[#587066]">{copy.due} {formatCircleDate(obligation.dueDate, locale)}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold">{formatCircleMoney(obligation.expectedAmount, currency)}</p><Badge label={label} className={status.className} /></div></li>; })}</ul>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{label}</dt><dd className="mt-1 text-sm font-medium text-[#173b32]">{value}</dd></div>;
}

function BottomNavigation({ dictionary }: { dictionary: Dictionary }) {
  const copy = dictionary.memberWorkspace;
  return <nav aria-label={copy.susuCircle} className="fixed inset-x-3 bottom-3 z-10 mx-auto flex max-w-md items-center justify-around rounded-2xl border border-[#e5ddd2] bg-[#fffdf9]/95 px-2 py-2 shadow-[0_8px_28px_rgba(77,57,40,0.14)] backdrop-blur sm:hidden"><BottomLink href="#member-workspace" icon="home" label={copy.home} active /><BottomLink href="#rotation-schedule" icon="calendar" label={copy.schedule} /><BottomLink href="#contribution-history" icon="list" label={copy.history} /><BottomLink href="#circle-details" icon="person" label={copy.profile} /></nav>;
}

function BottomLink({ href, icon, label, active = false }: { href: string; icon: IconName; label: string; active?: boolean }) {
  return <a href={href} className={`flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.625rem] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] ${active ? "text-[#ad4c2a]" : "text-[#587066]"}`}><Icon name={icon} compact /><span>{label}</span></a>;
}

type IconName = "calendar" | "list" | "people" | "document" | "home" | "person";

function Icon({ name, compact = false }: { name: IconName; compact?: boolean }) {
  const paths: Record<IconName, React.ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01" /></>,
    list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5M16 5.5a3 3 0 0 1 0 5M17 15c2.5.2 4 2 4 5" /></>,
    document: <><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" /></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${compact ? "size-5" : "size-6"} shrink-0 text-[#35634f]`}>{paths[name]}</svg>;
}

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function circleStatusLabel(status: string, dictionary: Dictionary) {
  const copy = dictionary.memberWorkspace;
  return ({ ACTIVE: copy.active, COMPLETED: copy.completed, ARCHIVED: copy.archived, CANCELLED: copy.cancelled }[status] ?? status);
}

function roundStatusLabel(round: RoundScheduleEntry, dictionary: Dictionary) {
  if (round.status === "ACTIVE") return dictionary.memberWorkspace.active;
  if (round.status === "CLOSED") return dictionary.susuFinancial.closed;
  return dictionary.susuFinancial.upcoming;
}
