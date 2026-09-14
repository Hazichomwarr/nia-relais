import Link from "next/link";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import { getStatusLabel } from "@/src/i18n/format";

export const CIRCLE_WORKSPACE_SECTIONS = ["overview", "contributions", "payouts", "members", "schedule"] as const;

export type CircleWorkspaceSection = (typeof CIRCLE_WORKSPACE_SECTIONS)[number];

const defaultLabels: Record<CircleWorkspaceSection, string> = {
  overview: "Overview",
  contributions: "Contributions",
  payouts: "Payouts",
  members: "Members",
  schedule: "Schedule",
};

const icons: Record<CircleWorkspaceSection, string> = {
  overview: "◌",
  contributions: "↙",
  payouts: "↗",
  members: "◉",
  schedule: "□",
};

export function getCircleWorkspaceSection(value: string | undefined): CircleWorkspaceSection {
  return CIRCLE_WORKSPACE_SECTIONS.includes(value as CircleWorkspaceSection)
    ? (value as CircleWorkspaceSection)
    : "overview";
}

export function CircleWorkspaceNavigation({
  circleId,
  section,
  circleName,
  status,
  terms,
  availableSections = CIRCLE_WORKSPACE_SECTIONS,
  dictionary,
}: {
  circleId: string;
  section: CircleWorkspaceSection;
  circleName: string;
  status: string;
  terms: string;
  availableSections?: readonly CircleWorkspaceSection[];
  dictionary?: Dictionary;
}) {
  const labels = dictionary ? { overview: dictionary.susuWorkspace.overview, contributions: dictionary.susuWorkspace.contributions, payouts: dictionary.susuWorkspace.payouts, members: dictionary.susuWorkspace.members, schedule: dictionary.susuWorkspace.schedule } : defaultLabels;
  return (
    <nav aria-label="Circle workspace" className="w-full min-w-0 shrink-0">
      <div className="hidden border-r border-[#e2d7c9] py-2 pr-6 md:block">
        <p className="text-lg font-semibold text-[#173b32]">{circleName}</p>
        <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${status === "ACTIVE" ? "bg-[#dce9dc] text-[#35634f]" : status === "DRAFT" ? "bg-[#fff0d9] text-[#8a5b27]" : "bg-[#efe7db] text-[#587066]"}`}>{dictionary ? getStatusLabel(status, dictionary) : status}</span>
        <p className="mt-3 text-sm leading-6 text-[#587066]">{terms}</p>
        <div className="mt-7 space-y-1">
        <div className="space-y-1">
          {availableSections.map((item) => (
            <WorkspaceLink key={item} circleId={circleId} item={item} section={section} labels={labels} />
          ))}
        </div>
        </div>
        <Link href="/circles" className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-[#587066] hover:text-[#173b32] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">← {dictionary?.susuWorkspace.backToCircles ?? "Back to my circles"}</Link>
      </div>

      <div className="md:hidden">
        <div className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 pr-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {availableSections.map((item) => (
            <WorkspaceLink key={item} circleId={circleId} item={item} section={section} compact labels={labels} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function WorkspaceLink({
  circleId,
  item,
  section,
  compact = false,
  labels,
}: {
  circleId: string;
  item: CircleWorkspaceSection;
  section: CircleWorkspaceSection;
  compact?: boolean;
  labels: Record<CircleWorkspaceSection, string>;
}) {
  const selected = item === section;
  return (
    <Link
      href={item === "overview" ? `/circles/${circleId}` : `/circles/${circleId}?section=${item}`}
      aria-current={selected ? "page" : undefined}
      className={`block shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] ${
        selected
          ? "bg-[#dce9dc] text-[#173b32]"
          : "text-[#587066] hover:bg-[#f7eee4] hover:text-[#173b32]"
      } ${compact ? "border border-[#dfd2c1] bg-[#fffdf8]" : ""}`}
    >
      <span aria-hidden="true" className="mr-2 text-base leading-none">{icons[item]}</span>{labels[item]}
    </Link>
  );
}
