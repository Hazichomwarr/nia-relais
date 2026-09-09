"use client";

import { useActionState, useState } from "react";

import { activateCircleAction } from "@/src/actions/circle.actions";
import { initialActivateCircleState } from "@/src/actions/circle.state";
import { computeActivationReviewFingerprint } from "@/src/domain/circle-activation-review";
import type { DraftCircleActivationReviewResult } from "@/src/services/circle-activation-review.service";

// The client submits only circleId, an explicit confirmation, and the
// fingerprint of the review it was actually shown -- never terms, member
// ids, payout order, totals, rounds, or obligations. activateCircleAction
// re-fetches the review fresh and re-derives eligibility itself; nothing
// computed here is trusted as authoritative (see activate-circle.ts).

function formatMoney(value: string, currency: string): string {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${groupedWhole}.${fractionPart.padEnd(2, "0")}`;
}

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

const BLOCKER_MESSAGES: Record<string, string> = {
  INSUFFICIENT_MEMBERS: "At least 2 active members are required to activate this circle.",
  INCOMPLETE_PAYOUT_ORDER: "Every active member needs a complete payout order before activating.",
};

export function ActivationReviewSection({
  circleId,
  review,
}: {
  circleId: string;
  review: DraftCircleActivationReviewResult;
}) {
  const [state, formAction, pending] = useActionState(activateCircleAction, initialActivateCircleState);
  const [confirmed, setConfirmed] = useState(false);
  const fingerprint = computeActivationReviewFingerprint(review);
  const canActivate = review.eligible && confirmed && !pending;

  return (
    <div>
      <p className="text-sm leading-6 text-[#587066]">
        Review your circle&apos;s active members, payout order, and proposed rotation before activating.
      </p>

      {!review.eligible ? (
        <ul className="mt-4 space-y-1.5">
          {review.blockers.map((blocker) => (
            <li key={blocker} className="text-sm leading-6 text-[#8a5b27]">
              {BLOCKER_MESSAGES[blocker] ?? blocker}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="mt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#7b8179]">
              Active members, in payout order
            </h3>
            <ol className="mt-2 divide-y divide-[#efe6d8]">
              {review.orderedActiveMembers.map((member, index) => (
                <li key={member.id} className="py-2 text-sm text-[#173b32]">
                  <span className="font-semibold">{index + 1}.</span> {member.displayName}{" "}
                  <span className="text-xs text-[#7b8179]">({member.memberCode})</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#7b8179]">Proposed rotation</h3>
            <ol className="mt-2 divide-y divide-[#efe6d8]">
              {review.proposedRounds.map((round) => (
                <li key={round.roundNumber} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[#173b32]">
                    Round {round.roundNumber} · {round.recipientDisplayName}{" "}
                    <span className="text-xs text-[#7b8179]">({round.recipientMemberCode})</span>
                  </p>
                  <p className="text-xs text-[#7b8179]">
                    Due {formatDueDate(round.dueDate)} · {formatMoney(round.expectedCollection, review.circle.currency)}{" "}
                    expected collection
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-5 rounded-2xl bg-[#f7eee4] p-4">
            <p className="text-sm text-[#587066]">
              Expected contribution per member:{" "}
              <span className="font-semibold text-[#173b32]">
                {formatMoney(review.expectedContributionPerMember, review.circle.currency)}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#587066]">
              Expected collection per round:{" "}
              <span className="font-semibold text-[#173b32]">
                {formatMoney(review.expectedCollectionPerRound, review.circle.currency)}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#587066]">
              Expected total across the full rotation:{" "}
              <span className="font-semibold text-[#173b32]">
                {formatMoney(review.expectedTotalAcrossRotation, review.circle.currency)}
              </span>
            </p>
            <p className="mt-3 text-xs leading-5 text-[#7b8179]">
              These are expected amounts, not money already collected or paid out. NIA tracks this circle&apos;s
              contributions and payouts as a shared ledger -- it does not hold or transfer money.
            </p>
          </div>
        </>
      )}

      <p className="mt-5 text-sm font-medium leading-6 text-[#a53f2b]">
        Once activated, the members, contribution terms, and payout order can no longer be changed.
      </p>

      <form action={formAction} className="mt-4">
        <input type="hidden" name="circleId" value={circleId} />
        <input type="hidden" name="reviewFingerprint" value={fingerprint} />
        <label className="flex items-start gap-2 text-sm text-[#173b32]">
          <input
            type="checkbox"
            name="confirmed"
            value="true"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={!review.eligible}
            className="mt-0.5"
          />
          <span>
            I have reviewed the members, payout order, and contribution terms and understand they cannot be
            changed after activation.
          </span>
        </label>

        {state.formError ? (
          <p role="alert" className="mt-3 text-sm font-medium text-[#b3261e]">
            {state.formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canActivate}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Activating…" : "Activate circle"}
        </button>
      </form>
    </div>
  );
}
