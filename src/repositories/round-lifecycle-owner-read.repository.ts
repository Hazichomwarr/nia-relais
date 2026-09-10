import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

// Read-only, owner-scoped -- same posture as payout-owner-read.repository
// .ts and circle-active-owner.repository.ts (no `client` parameter, no
// transaction, no lock: this file always reads through the bare `prisma`
// singleton). Circle lookup and every current-round financial read
// (obligations, confirmed-payment sums, payout) are deliberately NOT
// duplicated here: round-lifecycle.repository.ts's own
// findCircleForRoundLifecycle / findObligationsForLifecycleRound /
// findConfirmedPaymentSumsForLifecycle / findPayoutForLifecycleRound are
// already exactly-narrow, already Client-parameterized pure reads with no
// lock and no mutation -- round-lifecycle-owner-read.service.ts (7K.15)
// reuses them directly, passing `prisma`. This file exists ONLY for the
// one genuinely new read that write-side repository does not need: every
// round joined with its recipient's OWNER-facing display fields
// (displayName/memberCode), per this codebase's own per-consumer-select
// discipline (see payout-owner-read.repository.ts's own comment on why it
// defines its own round select rather than widening a sibling one).

const ownerRoundLifecycleRoundSelect = {
  id: true,
  roundNumber: true,
  recipientId: true,
  recipient: {
    select: {
      id: true,
      displayName: true,
      memberCode: true,
    },
  },
  dueDate: true,
  status: true,
  activatedAt: true,
  activatedById: true,
  closedAt: true,
  closedById: true,
} satisfies Prisma.PayoutRoundSelect;

export type OwnerRoundLifecycleRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof ownerRoundLifecycleRoundSelect;
}>;

/**
 * Every persisted round for the circle, ordered by roundNumber -- one
 * bounded query, never one per round. Selects both the mutable
 * lifecycle-state provenance (status/activatedAt/activatedById/closedAt/
 * closedById) the shared domain integrity checks need, AND the owner-
 * facing recipient display fields the read model's own current/next round
 * shape needs -- a round select round-lifecycle.repository.ts's own
 * write-side `findRoundsForLifecycle` deliberately does not carry (it only
 * needs recipientId as a scalar for its own re-verification, never a
 * joined display name).
 */
export function findRoundsForOwnerRoundLifecycle(circleId: string) {
  return prisma.payoutRound.findMany({
    where: { circleId },
    orderBy: { roundNumber: "asc" },
    select: ownerRoundLifecycleRoundSelect,
  });
}
