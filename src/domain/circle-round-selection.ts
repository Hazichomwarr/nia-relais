// Extracted from circle-member-dashboard.service.ts (7I.6), where this was
// a private module-scope function used only for the member dashboard's own
// "current/next round" framing. Shared here, unchanged, so the owner's
// active-circle summary (circle-active-owner.service.ts) uses the exact
// same round-selection rule -- never a second, independently-drifting
// definition of "current round" between what a member sees and what the
// owner sees.
//
// Deterministic current/next round selection:
// - If exactly one round is ACTIVE, it is "the current round."
// - Otherwise, for an ACTIVE circle only, the lowest-roundNumber round
//   that is not CLOSED is offered as "the next round" -- explicitly NOT
//   labeled "current," since nothing here infers ACTIVE-ness from a due
//   date having arrived. Every decision is based solely on the round's own
//   persisted `status` column.
// - For a non-ACTIVE circle (e.g. DRAFT is never reachable here in
//   practice, but a future COMPLETED/ARCHIVED circle) with no ACTIVE
//   round, neither field is set.
//
// currentRound and nextRound are mutually exclusive by construction. Pure
// and framework-free: no Prisma client, no "server-only".

export type RoundForSelection = {
  readonly roundNumber: number;
  readonly status: string;
};

export function selectCurrentAndNextRound<T extends RoundForSelection>(
  circleStatus: string,
  rounds: readonly T[],
): { currentRound: T | null; nextRound: T | null } {
  const activeRounds = rounds.filter((round) => round.status === "ACTIVE");
  if (activeRounds.length === 1) {
    return { currentRound: activeRounds[0], nextRound: null };
  }

  if (circleStatus !== "ACTIVE") {
    return { currentRound: null, nextRound: null };
  }

  const lowestNonClosed = [...rounds]
    .filter((round) => round.status !== "CLOSED")
    .sort((left, right) => left.roundNumber - right.roundNumber)[0];

  return { currentRound: null, nextRound: lowestNonClosed ?? null };
}
