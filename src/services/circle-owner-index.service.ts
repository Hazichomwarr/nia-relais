import "server-only";

import { findCirclesForOwnerIndex } from "@/src/repositories/circle-owner-index.repository";

export type OwnerCircleIndexStatus = "DRAFT" | "ACTIVE" | "COMPLETED";

export type OwnerCircleIndexRound = {
  readonly roundNumber: number;
  readonly recipientDisplayName: string;
  readonly dueDate: string;
  readonly status: "UPCOMING" | "ACTIVE" | "CLOSED";
};

export type OwnerCircleIndexItem = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly status: OwnerCircleIndexStatus;
  readonly memberCount: number;
  // This is a persisted-state preview only. It does not decide whether a
  // round may transition or calculate financial readiness.
  readonly currentOrNextRound: OwnerCircleIndexRound | null;
};

export async function getCirclesForOwnerIndex(ownerId: string): Promise<readonly OwnerCircleIndexItem[]> {
  const circles = await findCirclesForOwnerIndex(ownerId);

  return circles.map((circle) => {
    const round = circle.rounds.find((item) => item.status === "ACTIVE")
      ?? circle.rounds.find((item) => item.status === "UPCOMING")
      ?? null;

    return {
      id: circle.id,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      status: circle.status as OwnerCircleIndexStatus,
      memberCount: circle.members.length,
      currentOrNextRound: round
        ? {
            roundNumber: round.roundNumber,
            recipientDisplayName: round.recipient.displayName,
            dueDate: round.dueDate.toISOString(),
            status: round.status,
          }
        : null,
    };
  });
}
