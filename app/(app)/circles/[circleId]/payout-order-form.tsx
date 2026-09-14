"use client";

import { useActionState, useState } from "react";

import { setDraftCirclePayoutOrderAction } from "@/src/actions/circle.actions";
import { initialSetDraftCirclePayoutOrderState } from "@/src/actions/circle.state";
import type { DraftCircleOwnerMemberResult } from "@/src/services/circle-draft-owner.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import { presentSusuDraftError } from "@/src/i18n/susu-draft-error-presentation";

// Move-up/move-down, deliberately not drag-and-drop: reliable on touch
// screens, keyboard-operable for free (plain <button> elements), and
// simpler to implement correctly than a drag interaction that would also
// need its own keyboard-accessible fallback to meet this project's
// existing accessibility bar.
//
// Rearranging locally never touches the server -- only pressing "Save
// payout order" submits anything. getDraftCircleForOwner's own members
// array is already ordered exactly right as the initial editable sequence
// in every case this needs: payoutOrder ASC NULLS LAST, then addedAt ASC,
// then id ASC (see circle-draft-owner.service.ts) -- when every ACTIVE
// member already has a payoutOrder, that IS a payoutOrder-ascending sort;
// when none do, nulls-last collapses to the addedAt/id fallback. No
// separate sort is re-implemented here.

export function PayoutOrderForm({
  circleId,
  members,
  dictionary,
}: {
  circleId: string;
  members: readonly DraftCircleOwnerMemberResult[];
  dictionary: Dictionary;
}) {
  const copy = dictionary.susu;
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const [order, setOrder] = useState<readonly DraftCircleOwnerMemberResult[]>(activeMembers);
  const [state, formAction, pending] = useActionState(
    setDraftCirclePayoutOrderAction,
    initialSetDraftCirclePayoutOrderState,
  );

  // What's actually persisted, for the purpose of the "Saved" indicator
  // below: the freshly-saved sequence if a save just succeeded, otherwise
  // each member's own payoutOrder from the original read. Derived at
  // render time -- no effect/setState needed to react to a successful
  // save, since `state` already carries everything required.
  const savedPayoutOrderById =
    state.status === "success" && state.members
      ? new Map(state.members.map((member) => [member.id, member.payoutOrder]))
      : null;

  function persistedPayoutOrderFor(member: DraftCircleOwnerMemberResult): number | null {
    return savedPayoutOrderById?.get(member.id) ?? member.payoutOrder;
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setOrder((current) => {
      const next = [...current];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setOrder((current) => {
      if (index >= current.length - 1) return current;
      const next = [...current];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  // "Saved" only when every position in the current local sequence
  // already matches its member's own persisted payoutOrder -- true after
  // a fresh load with a complete saved order, or right after a successful
  // save; false the moment the owner rearranges, and false for a never-
  // saved (all-null) cohort.
  const isSaved = order.length > 0 && order.every((member, index) => persistedPayoutOrderFor(member) === index + 1);

  if (activeMembers.length === 0) {
    return <p className="text-sm leading-6 text-[#587066]">{copy.payoutOrderEmpty}</p>;
  }

  return (
    <div>
      <p className="text-sm leading-6 text-[#587066]">
        {copy.payoutOrderDescription}
      </p>
      {activeMembers.length < 2 ? (
        <p className="mt-3 text-sm leading-6 text-[#8a5b27]">
          {copy.payoutOrderMinimum}
        </p>
      ) : null}

      <ol className="mt-4 divide-y divide-[#efe6d8]">
        {order.map((member, index) => (
          <li key={member.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <p className="text-sm text-[#173b32]">
              <span className="font-semibold">{index + 1}.</span> {member.displayName}{" "}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                aria-label={copy.moveUpAria.replace("{name}", member.displayName)}
                className="rounded-full border border-[#cdbda9] px-2.5 py-1 text-xs font-semibold text-[#173b32] transition-colors hover:border-[#b96549] hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copy.moveUp}
              </button>
              <button
                type="button"
                onClick={() => moveDown(index)}
                disabled={index === order.length - 1}
                aria-label={copy.moveDownAria.replace("{name}", member.displayName)}
                className="rounded-full border border-[#cdbda9] px-2.5 py-1 text-xs font-semibold text-[#173b32] transition-colors hover:border-[#b96549] hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copy.moveDown}
              </button>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#7b8179]" role="status">
        {isSaved ? copy.saved : copy.notSaved}
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="circleId" value={circleId} />
        {order.map((member) => (
          <input key={member.id} type="hidden" name="memberId" value={member.id} />
        ))}
        {state.formError ? (
          <p role="alert" className="mb-3 text-sm font-medium text-[#b3261e]">
            {presentSusuDraftError(state.formError, copy)}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? copy.saving : copy.savePayoutOrder}
        </button>
      </form>
    </div>
  );
}
