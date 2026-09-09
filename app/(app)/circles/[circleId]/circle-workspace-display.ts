// Pure, framework-free presentation helpers shared across the owner
// circle workspace (draft member list, 7I.3) and the active-circle summary
// (7I.6) -- no React, no service/repository access.

export function getMemberStatusBadgeLabel(status: string): string {
  return status === "REMOVED" ? "Removed" : "Active";
}

export function formatOwnerDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export type RoundStatusBadge = { readonly label: string; readonly className: string };

const ROUND_STATUS_BADGES: Record<string, RoundStatusBadge> = {
  ACTIVE: { label: "Active", className: "bg-[#e6f0e8] text-[#35634f]" },
  CLOSED: { label: "Closed", className: "bg-[#efe7db] text-[#587066]" },
  UPCOMING: { label: "Upcoming", className: "bg-[#fff0d9] text-[#8a5b27]" },
};

/**
 * Labels a round's own persisted status verbatim -- never infers ACTIVE
 * from a due date having passed, and UPCOMING is never worded as
 * "currently collecting" (matches the member dashboard's identical
 * convention in app/member/circles/[circleId]/member-dashboard-display.ts,
 * kept as a separate small copy rather than a cross-tree import since
 * these are two different audiences' presentation layers).
 */
export function getRoundStatusBadge(status: string): RoundStatusBadge {
  return ROUND_STATUS_BADGES[status] ?? { label: status, className: "bg-[#efe7db] text-[#587066]" };
}
