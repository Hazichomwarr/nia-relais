"use client";

import { useActionState, useState } from "react";

import { activateCircleAction } from "@/src/actions/circle.actions";
import { initialActivateCircleState } from "@/src/actions/circle.state";
import { computeActivationReviewFingerprint } from "@/src/domain/circle-activation-review";
import type { DraftCircleActivationReviewResult } from "@/src/services/circle-activation-review.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import { formatDate, formatMoney } from "@/src/i18n/format";
import { presentSusuDraftError } from "@/src/i18n/susu-draft-error-presentation";

// The client submits only circleId, an explicit confirmation, and the
// fingerprint of the review it was actually shown -- never terms, member
// ids, payout order, totals, rounds, or obligations. activateCircleAction
// re-fetches the review fresh and re-derives eligibility itself; nothing
// computed here is trusted as authoritative (see activate-circle.ts).

export function ActivationReviewSection({
  circleId,
  review,
  dictionary,
  locale,
}: {
  circleId: string;
  review: DraftCircleActivationReviewResult;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.susu;
  const blockers: Record<string, string> = { INSUFFICIENT_MEMBERS: copy.blockerInsufficientMembers, INCOMPLETE_PAYOUT_ORDER: copy.blockerIncompletePayoutOrder };
  const [state, formAction, pending] = useActionState(activateCircleAction, initialActivateCircleState);
  const [confirmed, setConfirmed] = useState(false);
  const fingerprint = computeActivationReviewFingerprint(review);
  const canActivate = review.eligible && confirmed && !pending;

  return (
    <div>
      <p className="text-sm leading-6 text-[#587066]">
        {copy.activationDescription}
      </p>

      {!review.eligible ? (
        <ul className="mt-4 space-y-1.5">
          {review.blockers.map((blocker) => (
            <li key={blocker} className="text-sm leading-6 text-[#8a5b27]">
              {blockers[blocker] ?? blocker}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="mt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#7b8179]">
              {copy.activationMembers}
            </h3>
            <ol className="mt-2 divide-y divide-[#efe6d8]">
              {review.orderedActiveMembers.map((member, index) => (
                <li key={member.id} className="py-2 text-sm text-[#173b32]">
                  <span className="font-semibold">{index + 1}.</span> {member.displayName}{" "}
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#7b8179]">{copy.proposedRotation}</h3>
            <ol className="mt-2 divide-y divide-[#efe6d8]">
              {review.proposedRounds.map((round) => (
                <li key={round.roundNumber} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[#173b32]">
                    {copy.round.replace("{number}", String(round.roundNumber))} · {round.recipientDisplayName}{" "}
                    <span className="text-xs text-[#7b8179]">({round.recipientMemberCode})</span>
                  </p>
                  <p className="text-xs text-[#7b8179]">
                    {copy.due.replace("{date}", formatDate(round.dueDate, locale))} · {copy.expectedCollection.replace("{amount}", formatMoney(round.expectedCollection, review.circle.currency))}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-5 rounded-2xl bg-[#f7eee4] p-4">
            <p className="text-sm text-[#587066]">
              {copy.expectedContribution}{" "}
              <span className="font-semibold text-[#173b32]">
                {formatMoney(review.expectedContributionPerMember, review.circle.currency)}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#587066]">
              {copy.expectedRoundCollection}{" "}
              <span className="font-semibold text-[#173b32]">
                {formatMoney(review.expectedCollectionPerRound, review.circle.currency)}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#587066]">
              {copy.expectedRotationTotal}{" "}
              <span className="font-semibold text-[#173b32]">
                {formatMoney(review.expectedTotalAcrossRotation, review.circle.currency)}
              </span>
            </p>
            <p className="mt-3 text-xs leading-5 text-[#7b8179]">
              {copy.expectedDisclaimer}
            </p>
          </div>
        </>
      )}

      <p className="mt-5 text-sm font-medium leading-6 text-[#a53f2b]">
        {copy.activationFrozenNotice}
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
            {copy.activationConfirmation}
          </span>
        </label>

        {state.formError ? (
          <p role="alert" className="mt-3 text-sm font-medium text-[#b3261e]">
            {presentSusuDraftError(state.formError, copy)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canActivate}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? copy.activating : copy.activateCircle}
        </button>
      </form>
    </div>
  );
}
