"use client";

import { useActionState } from "react";

import {
  cancelCustodianAssignmentRequestAction,
  createCustodianAssignmentAction,
  endCustodianAssignmentAction,
  type CancelCustodianAssignmentActionState,
  type CreateCustodianAssignmentActionState,
  type EndCustodianAssignmentActionState,
} from "@/src/actions/custodian.actions";
import type { OwnerCustodianAssignmentState } from "@/src/services/custodian.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function GoalCustodianSection({ goalId, assignmentState, dictionary }: { goalId: string; assignmentState: OwnerCustodianAssignmentState; dictionary: Dictionary }) {
  const copy = dictionary.goalCustodian;
  const [createState, createAction, creating] = useActionState<CreateCustodianAssignmentActionState, FormData>(createCustodianAssignmentAction, {});
  const [cancelState, cancelAction, cancelling] = useActionState<CancelCustodianAssignmentActionState, FormData>(cancelCustodianAssignmentRequestAction, {});
  const [endState, endAction, ending] = useActionState<EndCustodianAssignmentActionState, FormData>(endCustodianAssignmentAction, {});
  const current = createState.assignment ? { ...createState.assignment.custodian, status: "PENDING", id: createState.assignment.assignmentId } : cancelState.assignment || endState.assignment ? null : assignmentState.current;
  const error = createState.formError ?? cancelState.formError ?? endState.formError;

  return <section className="rounded-[1.5rem] border border-[var(--nia-border)] bg-[var(--nia-surface)] p-5 shadow-sm sm:p-6" aria-labelledby="goal-custodian-heading">
    <h2 id="goal-custodian-heading" className="font-serif text-2xl tracking-tight">{dictionary.common.trustedPerson}</h2>
    {current ? <div className="mt-4 rounded-2xl bg-[var(--nia-surface-soft)] p-4"><p className="font-semibold text-[var(--nia-text)]">{current.displayName}</p><p className="mt-1 text-sm text-[var(--nia-text-muted)]">{current.status === "PENDING" ? copy.requestPending : copy.active}</p>{current.status === "PENDING" ? <form action={cancelAction} className="mt-3"><input type="hidden" name="assignmentId" value={current.id} /><button disabled={cancelling} className="text-sm font-semibold text-[var(--nia-primary)] underline">{dictionary.custodian.cancel}</button></form> : <form action={endAction} className="mt-3"><input type="hidden" name="assignmentId" value={current.id} /><button disabled={ending} className="text-sm font-semibold text-[var(--nia-primary)] underline">{dictionary.custodian.ended}</button></form>}</div> : <form action={createAction} className="mt-4"><label className="block text-sm font-semibold">{copy.emailLabel}<input name="custodianEmail" type="email" required className="mt-2 min-h-11 w-full rounded-xl border border-[var(--nia-border)] bg-white px-3" /></label><input type="hidden" name="goalId" value={goalId} /><p className="mt-2 text-sm text-[var(--nia-text-muted)]">{copy.emailHelp}</p><button disabled={creating} className="mt-4 min-h-11 rounded-full bg-[var(--nia-secondary)] px-4 text-sm font-semibold text-white">{creating ? copy.adding : copy.add}</button></form>}
    {!current && assignmentState.historical ? <p className="mt-4 text-sm text-[var(--nia-text-muted)]">{copy.previous}: {assignmentState.historical.displayName}</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--nia-secondary)]">{error}</p> : null}
  </section>;
}
