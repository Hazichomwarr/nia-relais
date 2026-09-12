"use client";

import { useActionState } from "react";

import { completeCircleAction } from "@/src/actions/circle-completion.actions";
import { initialCompleteCircleState } from "@/src/actions/circle-completion.state";

// Owner-only circle-completion control (7L.3), mirroring
// round-lifecycle-controls.tsx's own StartFirstRoundForm shape exactly:
// one form, one hidden circleId field, no other input. This component
// performs no eligibility computation of its own -- the parent server
// component (round-lifecycle-card.tsx) decides WHETHER to render this
// form at all, and only when getOwnerRoundLifecycle's own
// phase === "ALL_ROUNDS_CLOSED" already says every round has closed. On
// genuine success, the wrapping Server Action's own revalidatePath
// refreshes the page's server-rendered data (the route re-fetches
// getCompletedCircleSummaryForOwner and renders its COMPLETED branch) --
// this form never sets a local optimistic status of its own.

export function CompleteCircleForm({ circleId }: { circleId: string }) {
  const [state, formAction, pending] = useActionState(completeCircleAction, initialCompleteCircleState);

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
        {pending ? "Completing circle…" : "Complete circle"}
      </button>
    </form>
  );
}
