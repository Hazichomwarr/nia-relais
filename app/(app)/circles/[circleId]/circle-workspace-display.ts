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

// 9G: a deliberately distinct, quiet sage -- never the same "Closed"
// taupe (which would silently blend an owner-declared historical round
// into an ordinary NIA-managed one), never a warning/red treatment.
const IMPORTED_ROUND_BADGE: RoundStatusBadge = { label: "Imported history", className: "bg-[#e3e8df] text-[#4f6354]" };

/**
 * Labels a round's own persisted status verbatim -- never infers ACTIVE
 * from a due date having passed, and UPCOMING is never worded as
 * "currently collecting" (matches the member dashboard's identical
 * convention in app/member/circles/[circleId]/member-dashboard-display.ts,
 * kept as a separate small copy rather than a cross-tree import since
 * these are two different audiences' presentation layers).
 *
 * 9G (docs/product/susu-existing-import-contract-freeze.md §8, ticket
 * §2/§4): `closureBasis`, when supplied, is the presentation authority
 * for the one case `status` alone cannot distinguish -- a CLOSED round
 * whose closureBasis is IMPORTED_DECLARATION is the owner's own
 * historical declaration at import time, never a normal NIA-managed
 * closure (advanceRound). It is branded and worded entirely differently
 * ("Imported history," never "Closed"). Every other status is unchanged.
 */
export function getRoundStatusBadge(status: string, closureBasis?: string): RoundStatusBadge {
  if (status === "CLOSED" && closureBasis === "IMPORTED_DECLARATION") return IMPORTED_ROUND_BADGE;
  return ROUND_STATUS_BADGES[status] ?? { label: status, className: "bg-[#efe7db] text-[#587066]" };
}
