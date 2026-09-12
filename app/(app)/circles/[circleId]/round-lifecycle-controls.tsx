"use client";

import { useActionState } from "react";

import { activateFirstRoundAction, advanceRoundAction } from "@/src/actions/round-lifecycle.actions";
import { initialActivateFirstRoundState, initialAdvanceRoundState } from "@/src/actions/round-lifecycle.state";

import { getAdvanceCtaLabel } from "./round-lifecycle-display";

// Owner-only lifecycle mutation controls (7K.16). Each form submits
// exactly the fields activateFirstRoundAction/advanceRoundAction accept
// -- circleId alone for the first-round start, circleId plus the CURRENT
// round's own id for advance -- and nothing else: no ownerId, no roundId
// on the first-round form, no nextRoundId/status/activatedAt/
// activatedById/closedAt/closedById, and no financial-readiness flag.
// Neither form performs any eligibility computation of its own; the
// parent server component (round-lifecycle-card.tsx) decides WHICH of
// these to render, and ONLY when getOwnerRoundLifecycle's own
// progression fields already say it is legitimate to do so. On genuine
// success, the wrapping Server Action's own revalidatePath refreshes the
// page's server-rendered lifecycle data -- neither form ever sets a
// local optimistic phase/round/status of its own.

export function StartFirstRoundForm({ circleId }: { circleId: string }) {
  const [state, formAction, pending] = useActionState(activateFirstRoundAction, initialActivateFirstRoundState);

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="circleId" value={circleId} />

      {state.status === "success" && state.message ? (
        <p role="status" aria-live="polite" className="mb-2 text-sm font-medium text-[#35634f]">
          {state.message}
        </p>
      ) : null}

      {state.formError ? (
        <p role="alert" className="mb-2 text-sm font-medium text-[#b3261e]">
          {state.formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#35634f] px-5 text-sm font-semibold text-white transition hover:bg-[#274a3a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35634f] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Starting round…" : "Start round 1"}
      </button>
    </form>
  );
}

export function AdvanceRoundForm({
  circleId,
  roundId,
  transitionKind,
  currentRoundNumber,
  nextRoundNumber,
}: {
  circleId: string;
  roundId: string;
  transitionKind: "ADVANCE_TO_NEXT_ROUND" | "CLOSE_FINAL_ROUND";
  currentRoundNumber: number;
  nextRoundNumber: number | null;
}) {
  const [state, formAction, pending] = useActionState(advanceRoundAction, initialAdvanceRoundState);
  const ctaLabel = getAdvanceCtaLabel(transitionKind, currentRoundNumber, nextRoundNumber);
  const isFinalRound = transitionKind === "CLOSE_FINAL_ROUND";

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="roundId" value={roundId} />

      <p className="mb-2 text-xs leading-5 text-[#7b8179]">
        {isFinalRound
          ? "This closes the final rotation round."
          : "Closing this round immediately starts the next round — this is one operation, not two."}
      </p>

      {state.status === "success" && state.message ? (
        <p role="status" aria-live="polite" className="mb-2 text-sm font-medium text-[#35634f]">
          {state.message}
        </p>
      ) : null}

      {state.formError ? (
        <p role="alert" className="mb-2 text-sm font-medium text-[#b3261e]">
          {state.formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#35634f] px-5 text-sm font-semibold text-white transition hover:bg-[#274a3a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35634f] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Updating round…" : ctaLabel}
      </button>
    </form>
  );
}
