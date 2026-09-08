"use client";

import { useActionState, useState } from "react";

import {
  completePersonalGoalAction,
  type CompletePersonalGoalActionState,
} from "@/src/actions/goal.actions";

export function CompleteGoalControl({ goalId }: { goalId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<CompletePersonalGoalActionState, FormData>(
    completePersonalGoalAction,
    {},
  );

  if (state.status === "success" && state.completion) {
    return (
      <p className="mt-4 rounded-2xl bg-[#e5efe5] p-4 text-sm leading-6 text-[#315b4b]" role="status">
        {state.completion.alreadyCompleted
          ? "This goal is already complete."
          : "You kept your promise to yourself. This goal is now complete."}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#b96549] px-4 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035]"
        aria-expanded="false"
        aria-controls={`complete-goal-confirmation-${goalId}`}
      >
        Complete goal
      </button>
    );
  }

  return (
    <div
      id={`complete-goal-confirmation-${goalId}`}
      className="mt-4 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-4"
      role="region"
      aria-label="Confirm completing this goal"
    >
      <p className="text-sm leading-6 text-[#5a6b61]">
        This marks your goal complete. You will not be able to add new savings afterward, though you can archive the goal later.
      </p>
      <p className="mt-2 text-xs leading-5 text-[#7b8179]">This cannot currently be undone.</p>

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="goalId" value={goalId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#b96549] px-4 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Completing goal…" : "Confirm completion"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-4 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Keep goal active
        </button>
      </form>

      {state.fieldErrors?.goalId?.map((error) => (
        <p key={error} className="mt-3 text-sm text-[#a53f2b]" role="alert">
          {error}
        </p>
      ))}
      {state.formError ? (
        <p className="mt-3 text-sm text-[#a53f2b]" role="alert">
          {state.formError}
        </p>
      ) : null}
    </div>
  );
}
