"use client";

import { useActionState, useState } from "react";

import {
  archivePersonalGoalAction,
  type ArchivePersonalGoalActionState,
} from "@/src/actions/goal.actions";

export function ArchiveGoalControl({ goalId }: { goalId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ArchivePersonalGoalActionState, FormData>(
    archivePersonalGoalAction,
    {},
  );

  if (state.status === "success" && state.archive) {
    return (
      <p className="mt-4 rounded-2xl bg-[#edf0e8] p-4 text-sm leading-6 text-[#556257]" role="status">
        {state.archive.alreadyArchived
          ? "This goal is already in your archived history."
          : "Goal archived. Your savings history is still preserved."}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-4 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035]"
        aria-expanded="false"
        aria-controls={`archive-goal-confirmation-${goalId}`}
      >
        Archive goal
      </button>
    );
  }

  return (
    <div
      id={`archive-goal-confirmation-${goalId}`}
      className="mt-4 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-4"
      role="region"
      aria-label="Confirm archiving this goal"
    >
      <p className="text-sm leading-6 text-[#5a6b61]">
        This moves the goal to your archived history. It does not delete the goal, and your savings history remains preserved.
      </p>
      <p className="mt-2 text-xs leading-5 text-[#7b8179]">
        The goal cannot currently be reopened. This action does not move or withdraw money.
      </p>

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="goalId" value={goalId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#6d7768] px-4 text-sm font-semibold text-white transition hover:bg-[#596352] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Archiving goal…" : "Confirm archive"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-4 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Keep in completed goals
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
