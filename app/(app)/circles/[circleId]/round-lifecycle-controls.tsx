"use client";

import { useActionState } from "react";

import { activateFirstRoundAction, advanceRoundAction } from "@/src/actions/round-lifecycle.actions";
import { initialActivateFirstRoundState, initialAdvanceRoundState } from "@/src/actions/round-lifecycle.state";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

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

export function StartFirstRoundForm({
  circleId,
  dictionary,
  variant = "new",
}: {
  circleId: string;
  dictionary: Dictionary;
  // 9F: the same activateFirstRoundAction/activateFirstRound now targets
  // round 1 for a NEW circle or round K+1 for an IMPORTED circle
  // (src/domain/round-lifecycle.ts's firstLiveRoundNumber) -- this prop
  // only selects truthful presentation copy; it changes no submitted
  // field and no eligibility. "imported" must never imply the historical
  // rounds themselves were managed by NIA (ticket 9F §12).
  variant?: "new" | "imported";
}) {
  const copy = dictionary.susuFinancial;
  const [state, formAction, pending] = useActionState(activateFirstRoundAction, initialActivateFirstRoundState);
  const isImported = variant === "imported";

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="circleId" value={circleId} />

      {state.status === "success" && state.message ? (
        <p role="status" aria-live="polite" className="mb-2 text-sm font-medium text-[#35634f]">
          {copy.lifecycleSuccess}
        </p>
      ) : null}

      {state.formError ? (
        <p role="alert" className="mb-2 text-sm font-medium text-[#b3261e]">
          {copy.lifecycleError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#35634f] px-5 text-sm font-semibold text-white transition hover:bg-[#274a3a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35634f] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {isImported ? (pending ? copy.startingNiaTracking : copy.startNiaTracking) : pending ? copy.startingRound : copy.startFirstRound}
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
  dictionary,
}: {
  circleId: string;
  roundId: string;
  transitionKind: "ADVANCE_TO_NEXT_ROUND" | "CLOSE_FINAL_ROUND";
  currentRoundNumber: number;
  nextRoundNumber: number | null;
  dictionary: Dictionary;
}) {
  const copy = dictionary.susuFinancial;
  const [state, formAction, pending] = useActionState(advanceRoundAction, initialAdvanceRoundState);
  void getAdvanceCtaLabel(transitionKind, currentRoundNumber, nextRoundNumber);
  const isFinalRound = transitionKind === "CLOSE_FINAL_ROUND";

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="roundId" value={roundId} />

      <p className="mb-2 text-xs leading-5 text-[#7b8179]">
        {isFinalRound
          ? copy.finalRoundNotice
          : copy.advanceNotice}
      </p>

      {state.status === "success" && state.message ? (
        <p role="status" aria-live="polite" className="mb-2 text-sm font-medium text-[#35634f]">
          {copy.lifecycleSuccess}
        </p>
      ) : null}

      {state.formError ? (
        <p role="alert" className="mb-2 text-sm font-medium text-[#b3261e]">
          {copy.lifecycleError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#35634f] px-5 text-sm font-semibold text-white transition hover:bg-[#274a3a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35634f] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? copy.updatingRound : isFinalRound ? copy.closeFinalRound : copy.advanceRound}
      </button>
    </form>
  );
}
