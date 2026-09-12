import Link from "next/link";

export const CIRCLE_WORKSPACE_SECTIONS = ["overview", "contributions", "payouts", "members", "schedule"] as const;

export type CircleWorkspaceSection = (typeof CIRCLE_WORKSPACE_SECTIONS)[number];

const labels: Record<CircleWorkspaceSection, string> = {
  overview: "Overview",
  contributions: "Contributions",
  payouts: "Payouts",
  members: "Members",
  schedule: "Schedule",
};

export function getCircleWorkspaceSection(value: string | undefined): CircleWorkspaceSection {
  return CIRCLE_WORKSPACE_SECTIONS.includes(value as CircleWorkspaceSection)
    ? (value as CircleWorkspaceSection)
    : "overview";
}

export function CircleWorkspaceNavigation({
  circleId,
  section,
  availableSections = CIRCLE_WORKSPACE_SECTIONS,
}: {
  circleId: string;
  section: CircleWorkspaceSection;
  availableSections?: readonly CircleWorkspaceSection[];
}) {
  return (
    <nav aria-label="Circle workspace" className="shrink-0">
      <div className="hidden rounded-[1.5rem] border border-[#dfd2c1] bg-[#fffdf8] p-3 shadow-[0_8px_30px_rgba(77,57,40,0.06)] md:block">
        <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#7b8179]">This circle</p>
        <div className="space-y-1">
          {availableSections.map((item) => (
            <WorkspaceLink key={item} circleId={circleId} item={item} section={section} />
          ))}
        </div>
      </div>

      <div className="md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {availableSections.map((item) => (
            <WorkspaceLink key={item} circleId={circleId} item={item} section={section} compact />
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
}: {
  circleId: string;
  item: CircleWorkspaceSection;
  section: CircleWorkspaceSection;
  compact?: boolean;
}) {
  const selected = item === section;
  return (
    <Link
      href={item === "overview" ? `/circles/${circleId}` : `/circles/${circleId}?section=${item}`}
      aria-current={selected ? "page" : undefined}
      className={`block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] ${
        selected
          ? "bg-[#dce9dc] text-[#173b32]"
          : "text-[#587066] hover:bg-[#f7eee4] hover:text-[#173b32]"
      } ${compact ? "border border-[#dfd2c1] bg-[#fffdf8]" : ""}`}
    >
      {labels[item]}
    </Link>
  );
}
