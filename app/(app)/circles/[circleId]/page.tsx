import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/src/auth/require-user";
import {
  ActiveCircleOwnerReadAuthorizationError,
  ActiveCircleOwnerReadNotActiveError,
  ActiveCircleOwnerReadNotFoundError,
  getActiveCircleSummaryForOwner,
  type ActiveCircleOwnerSummaryResult,
} from "@/src/services/circle-active-owner.service";
import { getDraftCircleActivationReview } from "@/src/services/circle-activation-review.service";
import {
  DraftCircleOwnerReadAuthorizationError,
  DraftCircleOwnerReadNotDraftError,
  DraftCircleOwnerReadNotFoundError,
  getDraftCircleForOwner,
  type DraftCircleOwnerCircleResult,
  type DraftCircleOwnerMemberResult,
} from "@/src/services/circle-draft-owner.service";
import {
  getOwnerCircleContributions,
  OwnerContributionsAuthorizationError,
  OwnerContributionsCircleNotActiveError,
  OwnerContributionsCircleNotFoundError,
  type OwnerCircleContributionsResult,
} from "@/src/services/contribution-owner-read.service";
import {
  getOwnerCirclePayouts,
  OwnerPayoutsAuthorizationError,
  OwnerPayoutsCircleNotEligibleError,
  OwnerPayoutsCircleNotFoundError,
  type OwnerCirclePayoutsResult,
} from "@/src/services/payout-owner-read.service";
import {
  getOwnerRoundLifecycle,
  OwnerRoundLifecycleAuthorizationError,
  OwnerRoundLifecycleCircleNotEligibleError,
  OwnerRoundLifecycleCircleNotFoundError,
  type OwnerRoundLifecycleResult,
} from "@/src/services/round-lifecycle-owner-read.service";
import type { DraftCircleActivationReviewResult } from "@/src/domain/circle-activation-review";

import { getFrequencyLabel } from "../new/new-circle-form-display";
import { ActiveCircleSummary } from "./active-circle-summary";
import { ActivationReviewSection } from "./activation-review-section";
import { AddMemberForm } from "./add-member-form";
import { ContributionDesk } from "./contribution-desk";
import { MemberList } from "./member-list";
import { PayoutDesk } from "./payout-desk";
import { PayoutOrderForm } from "./payout-order-form";
import { RoundLifecycleCard } from "./round-lifecycle-card";

export const metadata: Metadata = {
  title: "Your circle · NIA",
};

type DraftWorkspaceData = {
  readonly kind: "draft";
  readonly circle: DraftCircleOwnerCircleResult;
  readonly members: readonly DraftCircleOwnerMemberResult[];
  readonly review: DraftCircleActivationReviewResult;
};

type ActiveSummaryData = {
  readonly kind: "active";
  readonly summary: ActiveCircleOwnerSummaryResult;
  readonly contributions: OwnerCircleContributionsResult;
  readonly payouts: OwnerCirclePayoutsResult;
  readonly lifecycle: OwnerRoundLifecycleResult;
};

// All data fetching (and the try/catch it needs) happens below, before any
// JSX is constructed -- react-hooks/error-boundaries flags JSX built
// inside a try/catch (React errors surface during render/commit, not at
// JSX-literal-construction time, so a try/catch around JSX doesn't
// actually catch anything meaningful). Every await lives in this
// data-only section; both return statements at the bottom are ordinary,
// unwrapped JSX.
async function loadWorkspaceOrSummary(
  ownerId: string,
  circleId: string,
): Promise<DraftWorkspaceData | ActiveSummaryData> {
  try {
    const [{ circle, members }, review] = await Promise.all([
      getDraftCircleForOwner({ ownerId, circleId }),
      getDraftCircleActivationReview({ ownerId, circleId }),
    ]);
    return { kind: "draft", circle, members, review };
  } catch (error) {
    // Not found and wrong owner are collapsed into the same generic 404 --
    // matching the existing convention for Personal Savings goal pages
    // (GoalNotFoundOrUnauthorizedError -> notFound() in
    // goals/[goalId]/deposits/[depositId]/page.tsx) -- so this page never
    // reveals which case applied, or whether some other owner's circle
    // exists at this id.
    if (
      error instanceof DraftCircleOwnerReadNotFoundError
      || error instanceof DraftCircleOwnerReadAuthorizationError
    ) {
      notFound();
    }

    if (!(error instanceof DraftCircleOwnerReadNotDraftError)) {
      throw error;
    }

    // "Not a draft" for a circle this owner genuinely owns can only mean
    // ACTIVE today -- nothing in this codebase transitions a circle to
    // COMPLETED, ARCHIVED, or CANCELLED yet -- so fall back to the owner's
    // active-circle summary instead of a 404. This is exactly the
    // successful-activation destination activateCircleAction redirects to.
    //
    // Future lifecycle dependency (7I.6, section 6): getActiveCircleSummaryForOwner
    // itself only accepts status === "ACTIVE" and throws
    // ActiveCircleOwnerReadNotActiveError for anything else -- so IF a
    // future ticket ever introduces a COMPLETED/ARCHIVED transition, a
    // circle in one of those states would land here, fail this read too,
    // and safely 404 rather than being misrepresented as ACTIVE. That is
    // the correct behavior for now (those states aren't reachable), but a
    // real COMPLETED/ARCHIVED owner summary does not exist yet and would
    // need its own read model when that lifecycle work begins.
    try {
      // Fetched in parallel: four independent, lock-free reads of the same
      // ACTIVE circle -- getOwnerCircleContributions (7J.5) is the read
      // model the contribution desk (7J.7) renders, getOwnerCirclePayouts
      // (7K.7) is the read model the payout desk (7K.9) renders, and
      // getOwnerRoundLifecycle (7K.15) is the read model the round-lifecycle
      // card (7K.16) renders. Neither is ever queried directly against
      // Prisma from a component, and no per-round/per-payout/per-obligation
      // fetch happens anywhere else on this page.
      const [summary, contributions, payouts, lifecycle] = await Promise.all([
        getActiveCircleSummaryForOwner({ ownerId, circleId }),
        getOwnerCircleContributions({ ownerId, circleId }),
        getOwnerCirclePayouts({ ownerId, circleId }),
        getOwnerRoundLifecycle({ ownerId, circleId }),
      ]);
      return { kind: "active", summary, contributions, payouts, lifecycle };
    } catch (activeReadError) {
      if (
        activeReadError instanceof ActiveCircleOwnerReadNotFoundError
        || activeReadError instanceof ActiveCircleOwnerReadAuthorizationError
        || activeReadError instanceof ActiveCircleOwnerReadNotActiveError
        || activeReadError instanceof OwnerContributionsCircleNotFoundError
        || activeReadError instanceof OwnerContributionsAuthorizationError
        || activeReadError instanceof OwnerContributionsCircleNotActiveError
        || activeReadError instanceof OwnerPayoutsCircleNotFoundError
        || activeReadError instanceof OwnerPayoutsAuthorizationError
        || activeReadError instanceof OwnerPayoutsCircleNotEligibleError
        || activeReadError instanceof OwnerRoundLifecycleCircleNotFoundError
        || activeReadError instanceof OwnerRoundLifecycleAuthorizationError
        || activeReadError instanceof OwnerRoundLifecycleCircleNotEligibleError
      ) {
        notFound();
      }
      // A genuine OwnerRoundLifecycleIntegrityError (or any other truly
      // unexpected error) is deliberately left to propagate to Next's own
      // error boundary here, exactly like OwnerPayoutsIntegrityError already
      // does above (7K.16 section 23) -- corrupted persisted lifecycle
      // history must never be silently disguised as an ordinary 404 or as
      // "round not ready yet."
      throw activeReadError;
    }
  }
}

// The draft circle workspace: circle terms (7I.2), member management
// (7I.3), payout ordering (7I.4), and activation review (7I.5) -- all
// while the circle is DRAFT. Once activated, this same route renders the
// owner's active-circle summary instead (7I.6): frozen terms, ordered
// members, the full persisted rotation, and the current/next round
// position. No contribution/payout recording, round open/close,
// completion, or archive UI exists anywhere on this route -- read-only
// throughout.
//
// Protected by app/(app)/layout.tsx's requireUser() already; requireUser()
// is called again here (not just trusted from the layout) because every
// read below needs a concrete, trusted ownerId to scope its query by. Every
// mutating Server Action (add/remove member, set payout order, activate)
// independently re-authorizes through requireUser() and the same
// owner-scoped domain services on every submission -- this page's own
// authorization is not relied upon as sufficient protection for those
// mutations, and activateCircle in particular re-reads and re-validates
// fresh state under its own row lock regardless of what this page (or the
// activation review) displayed a moment earlier.
export default async function OwnerCirclePage({
  params,
}: {
  params: Promise<{ circleId: string }>;
}) {
  const { circleId } = await params;
  const user = await requireUser();

  const data = await loadWorkspaceOrSummary(user.id, circleId);

  if (data.kind === "active") {
    return (
      <main className="min-h-[calc(100vh-73px)] flex flex-col gap-6 bg-[#fbf7ef] px-5 py-10 text-[#173b32] sm:px-8">
        <ActiveCircleSummary summary={data.summary} />
        <RoundLifecycleCard circleId={circleId} lifecycle={data.lifecycle} />
        <ContributionDesk circleId={circleId} contributions={data.contributions} />
        <PayoutDesk circleId={circleId} payouts={data.payouts} />
      </main>
    );
  }

  const { circle, members, review } = data;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-10 text-[#173b32] sm:px-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circles</p>
          <span className="mt-3 inline-flex w-fit rounded-full bg-[#fff0d9] px-3 py-1 text-sm font-semibold text-[#8a5b27]">
            DRAFT
          </span>
          <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{circle.name}</h1>
          <p className="mt-4 max-w-xl leading-7 text-[#587066]">
            Each member will contribute {circle.currency} {circle.contributionAmount}{" "}
            {getFrequencyLabel(circle.frequency)}.
          </p>
        </section>

        <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">Add a member</h2>
          <p className="mt-2 text-sm leading-6 text-[#587066]">
            Add someone you trust and will share their member code and PIN with, privately.
          </p>
          <div className="mt-5">
            <AddMemberForm circleId={circleId} />
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">Members</h2>
          <div className="mt-5">
            <MemberList circleId={circleId} members={members} />
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">Payout order</h2>
          <div className="mt-5">
            <PayoutOrderForm circleId={circleId} members={members} />
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">Review &amp; activate</h2>
          <div className="mt-5">
            <ActivationReviewSection circleId={circleId} review={review} />
          </div>
        </section>
      </div>
    </main>
  );
}
