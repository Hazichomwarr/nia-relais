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
import {
  CompletedCircleOwnerReadAuthorizationError,
  CompletedCircleOwnerReadNotCompletedError,
  CompletedCircleOwnerReadNotFoundError,
  getCompletedCircleSummaryForOwner,
  type CompletedCircleOwnerSummaryResult,
} from "@/src/services/circle-completed-owner.service";
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
  OwnerContributionsCircleNotEligibleError,
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
import { ActivationReviewSection } from "./activation-review-section";
import { AddMemberForm } from "./add-member-form";
import { CircleMemberReadList } from "./circle-member-read-list";
import { CircleSchedule } from "./circle-schedule";
import { CircleWorkspaceNavigation, getCircleWorkspaceSection, type CircleWorkspaceSection } from "./circle-workspace-navigation";
import { ActiveCircleWorkspaceOverview, CompletedCircleWorkspaceOverview } from "./circle-workspace-overview";
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

type CompletedSummaryData = {
  readonly kind: "completed";
  readonly summary: CompletedCircleOwnerSummaryResult;
  readonly contributions: OwnerCircleContributionsResult;
  readonly payouts: OwnerCirclePayoutsResult;
};

// All data fetching (and the try/catch it needs) happens below, before any
// JSX is constructed -- react-hooks/error-boundaries flags JSX built
// inside a try/catch (React errors surface during render/commit, not at
// JSX-literal-construction time, so a try/catch around JSX doesn't
// actually catch anything meaningful). Every await lives in this
// data-only section; every return statement at the bottom is ordinary,
// unwrapped JSX.
async function loadWorkspaceOrSummary(
  ownerId: string,
  circleId: string,
): Promise<DraftWorkspaceData | ActiveSummaryData | CompletedSummaryData> {
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

    // "Not a draft" for a circle this owner genuinely owns means ACTIVE or
    // COMPLETED (7L.3 fixes the former ACTIVE-only assumption here --
    // docs/product/susu-circle-completion-audit.md §14/§21/§27's own named
    // P1). getOwnerCirclePayouts is queried FIRST, not last: it already
    // accepts ACTIVE/COMPLETED/ARCHIVED (7K.7) and is needed by BOTH
    // branches below regardless, so reading its own circle.status once
    // decides which branch to take without any redundant read or a
    // separate "what status is this" probe. ARCHIVED remains out of scope
    // (7L §16, deferred) -- falls through to notFound() below, exactly
    // like every other status this route doesn't yet render a branch for.
    try {
      const payouts = await getOwnerCirclePayouts({ ownerId, circleId });

      if (payouts.circle.status === "ACTIVE") {
        // Fetched in parallel: three independent, lock-free reads of the
        // same ACTIVE circle -- getActiveCircleSummaryForOwner (7I.6),
        // getOwnerCircleContributions (7J.5, the read model the
        // contribution desk renders), and getOwnerRoundLifecycle (7K.15,
        // the read model the round-lifecycle card renders, and the sole
        // authority for whether that card's own completion CTA appears).
        const [summary, contributions, lifecycle] = await Promise.all([
          getActiveCircleSummaryForOwner({ ownerId, circleId }),
          getOwnerCircleContributions({ ownerId, circleId }),
          getOwnerRoundLifecycle({ ownerId, circleId }),
        ]);
        return { kind: "active", summary, contributions, payouts, lifecycle };
      }

      if (payouts.circle.status === "COMPLETED") {
        // getOwnerRoundLifecycle is deliberately NOT fetched here -- it
        // remains ACTIVE-only by design (7L.3 section 6: a completed
        // circle has no lifecycle transition left to make, so there is
        // nothing for that read to say). getCompletedCircleSummaryForOwner
        // (7L.3) is the dedicated historical summary; contributions are
        // fetched in parallel, now that 7L.3 extends their own eligibility
        // to COMPLETED too.
        const [summary, contributions] = await Promise.all([
          getCompletedCircleSummaryForOwner({ ownerId, circleId }),
          getOwnerCircleContributions({ ownerId, circleId }),
        ]);
        return { kind: "completed", summary, contributions, payouts };
      }

      notFound();
    } catch (activeOrCompletedReadError) {
      if (
        activeOrCompletedReadError instanceof OwnerPayoutsCircleNotFoundError
        || activeOrCompletedReadError instanceof OwnerPayoutsAuthorizationError
        || activeOrCompletedReadError instanceof OwnerPayoutsCircleNotEligibleError
        || activeOrCompletedReadError instanceof ActiveCircleOwnerReadNotFoundError
        || activeOrCompletedReadError instanceof ActiveCircleOwnerReadAuthorizationError
        || activeOrCompletedReadError instanceof ActiveCircleOwnerReadNotActiveError
        || activeOrCompletedReadError instanceof OwnerContributionsCircleNotFoundError
        || activeOrCompletedReadError instanceof OwnerContributionsAuthorizationError
        || activeOrCompletedReadError instanceof OwnerContributionsCircleNotEligibleError
        || activeOrCompletedReadError instanceof OwnerRoundLifecycleCircleNotFoundError
        || activeOrCompletedReadError instanceof OwnerRoundLifecycleAuthorizationError
        || activeOrCompletedReadError instanceof OwnerRoundLifecycleCircleNotEligibleError
        || activeOrCompletedReadError instanceof CompletedCircleOwnerReadNotFoundError
        || activeOrCompletedReadError instanceof CompletedCircleOwnerReadAuthorizationError
        || activeOrCompletedReadError instanceof CompletedCircleOwnerReadNotCompletedError
      ) {
        notFound();
      }
      // A genuine integrity error (OwnerPayoutsIntegrityError,
      // OwnerRoundLifecycleIntegrityError, or any other truly unexpected
      // error) is deliberately left to propagate to Next's own error
      // boundary here (7K.16 section 23) -- corrupted persisted history
      // must never be silently disguised as an ordinary 404 or as "round
      // not ready yet."
      throw activeOrCompletedReadError;
    }
  }
}

// The draft circle workspace: circle terms (7I.2), member management
// (7I.3), payout ordering (7I.4), and activation review (7I.5) -- all
// while the circle is DRAFT. Once activated, this same route renders the
// owner's active-circle summary instead (7I.6): frozen terms, ordered
// members, the full persisted rotation, and the current/next round
// position, plus round-lifecycle progression (7K.16) and the explicit
// circle-completion control once every round has closed (7L.3). Once the
// owner explicitly completes the circle, this route renders a third,
// historical branch (7L.3): the same permanent contribution/payout
// records, read-only, with no lifecycle or completion control left to
// show. No archive UI exists anywhere on this route yet (7L §16,
// deferred).
//
// Protected by app/(app)/layout.tsx's requireUser() already; requireUser()
// is called again here (not just trusted from the layout) because every
// read below needs a concrete, trusted ownerId to scope its query by. Every
// mutating Server Action (add/remove member, set payout order, activate,
// round lifecycle, circle completion) independently re-authorizes through
// requireUser() and the same owner-scoped domain services on every
// submission -- this page's own authorization is not relied upon as
// sufficient protection for those mutations, and each one re-reads and
// re-validates fresh state under its own row lock regardless of what this
// page displayed a moment earlier.
export default async function OwnerCirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ circleId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { circleId } = await params;
  const { section: requestedSection } = await searchParams;
  const section = getCircleWorkspaceSection(requestedSection);
  const user = await requireUser();

  const data = await loadWorkspaceOrSummary(user.id, circleId);

  if (data.kind === "active") {
    const activeSections: readonly CircleWorkspaceSection[] = ["overview", "contributions", "payouts", "members", "schedule"];
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-10">
        <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
          <CircleWorkspaceNavigation circleId={circleId} section={section} availableSections={activeSections} />
          <div className="min-w-0">
            {section === "overview" ? <ActiveCircleWorkspaceOverview circleId={circleId} summary={data.summary} contributions={data.contributions} payouts={data.payouts} lifecycle={data.lifecycle} /> : null}
            {section === "contributions" ? <ContributionDesk circleId={circleId} contributions={data.contributions} readOnly={false} /> : null}
            {section === "payouts" ? <PayoutDesk circleId={circleId} payouts={data.payouts} readOnly={false} /> : null}
            {section === "members" ? <CircleMemberReadList members={data.summary.members} /> : null}
            {section === "schedule" ? <div className="flex max-w-3xl flex-col gap-6"><CircleSchedule rounds={data.summary.rounds} /><RoundLifecycleCard circleId={circleId} lifecycle={data.lifecycle} /></div> : null}
          </div>
        </div>
      </main>
    );
  }

  if (data.kind === "completed") {
    const completedSections: readonly CircleWorkspaceSection[] = ["overview", "contributions", "payouts", "members", "schedule"];
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-10">
        <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
          <CircleWorkspaceNavigation circleId={circleId} section={section} availableSections={completedSections} />
          <div className="min-w-0">
            {section === "overview" ? <CompletedCircleWorkspaceOverview summary={data.summary} /> : null}
            {section === "contributions" ? <ContributionDesk circleId={circleId} contributions={data.contributions} readOnly /> : null}
            {section === "payouts" ? <PayoutDesk circleId={circleId} payouts={data.payouts} readOnly /> : null}
            {section === "members" ? <CircleMemberReadList members={data.summary.members} /> : null}
            {section === "schedule" ? <CircleSchedule rounds={data.payouts.rounds} /> : null}
          </div>
        </div>
      </main>
    );
  }

  const { circle, members, review } = data;
  const draftSections: readonly CircleWorkspaceSection[] = ["overview", "members", "schedule"];

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
        <CircleWorkspaceNavigation circleId={circleId} section={section} availableSections={draftSections} />
        <div className="min-w-0">
          {section === "overview" ? (
            <div className="max-w-3xl">
              <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circle</p>
                <span className="mt-3 inline-flex w-fit rounded-full bg-[#fff0d9] px-3 py-1 text-sm font-semibold text-[#8a5b27]">DRAFT</span>
                <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{circle.name}</h1>
                <p className="mt-4 max-w-xl leading-7 text-[#587066]">Each member will contribute {circle.currency} {circle.contributionAmount} {getFrequencyLabel(circle.frequency)}.</p>
                <p className="mt-5 text-sm leading-6 text-[#587066]">Set up your circle in order: add members, choose the payout order, then review and activate when everything is ready.</p>
              </section>
            </div>
          ) : null}
          {section === "members" ? (
            <div className="flex max-w-3xl flex-col gap-6">
              <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
                <h1 className="font-serif text-3xl tracking-tight">Members</h1>
                <p className="mt-2 text-sm leading-6 text-[#587066]">Add someone you trust and share their member code and PIN privately.</p>
                <div className="mt-5"><AddMemberForm circleId={circleId} /></div>
              </section>
              <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8"><MemberList circleId={circleId} members={members} /></section>
            </div>
          ) : null}
          {section === "schedule" ? (
            <div className="flex max-w-3xl flex-col gap-6">
              <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8"><h1 className="font-serif text-3xl tracking-tight">Payout order</h1><div className="mt-5"><PayoutOrderForm circleId={circleId} members={members} /></div></section>
              <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8"><h2 className="text-xl font-semibold tracking-tight text-[#173b32]">Review &amp; activate</h2><div className="mt-5"><ActivationReviewSection circleId={circleId} review={review} /></div></section>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
