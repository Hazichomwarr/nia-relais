import { z } from "zod";

// Own small copy of the round-id primitive, deliberately mirroring
// payout.schema.ts's own roundId validator (identical regex/length) --
// this codebase's established convention (see payout.schema.ts's own
// comment) is a small per-domain copy over a cross-domain import for
// these atoms, never a shared import from payout.schema.ts.
//
// Deliberately absent: circleId (read directly from the form and handed
// to the service after only a non-empty check, exactly like every other
// owner action in this codebase -- the service itself is the sole
// authority on whether it resolves to a real, owned circle), and every
// other round-lifecycle field (status, activatedAt, activatedById,
// closedAt, closedById, isFinalRound, nextRoundId, ...) -- none of those
// are ever accepted as input; they are only ever produced as output by
// round-lifecycle.service.ts.
//
// activateFirstRound needs no schema of its own: it takes only circleId,
// which every owner action already validates the same raw way (a
// non-empty-after-trim check, no regex) without a dedicated Zod object.

const APPLICATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const roundId = z
  .string()
  .trim()
  .min(1, "A payout round is required.")
  .max(100, "The round identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The round identifier is invalid.");

export const advanceRoundSchema = z.object({
  roundId,
});

export type AdvanceRoundInput = z.infer<typeof advanceRoundSchema>;
