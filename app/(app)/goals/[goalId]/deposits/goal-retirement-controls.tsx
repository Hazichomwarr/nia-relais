"use client";

import { useActionState } from "react";

import {
  abandonPersonalGoalAction,
  archivePersonalGoalAction,
  type AbandonPersonalGoalActionState,
  type ArchivePersonalGoalActionState,
} from "@/src/actions/goal.actions";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function GoalRetirementControls({ goalId, status, dictionary }: { goalId: string; status: "ACTIVE" | "COMPLETED"; dictionary: Dictionary }) {
  const copy = dictionary.retirement;
  const action = status === "ACTIVE" ? abandonPersonalGoalAction : archivePersonalGoalAction;
  const [state, formAction, pending] = useActionState(action, {} as AbandonPersonalGoalActionState & ArchivePersonalGoalActionState);
  const label = status === "ACTIVE" ? copy.abandonGoal : copy.archiveGoal;
  const description = status === "ACTIVE" ? copy.abandonGoalDescription : copy.archiveGoalDescription;
  return <section className="rounded-2xl border border-[#e5c5ba] bg-[#fff8f4] p-5"><h2 className="font-serif text-xl text-[#713d30]">{copy.retirement}</h2><p className="mt-2 text-sm leading-6 text-[#6b5147]">{description}</p><form action={formAction} className="mt-4"><input type="hidden" name="goalId" value={goalId} /><button type="submit" disabled={pending} onClick={(event) => { if (!window.confirm(copy.confirm)) event.preventDefault(); }} className="min-h-11 rounded-full border border-[#b45e46] px-5 text-sm font-semibold text-[#8a3e2d] transition hover:bg-[#fbe9e2] disabled:opacity-60">{pending ? copy.working : label}</button>{state.formError ? <p className="mt-3 text-sm text-[#8a3e2d]">{state.formError}</p> : null}</form></section>;
}
