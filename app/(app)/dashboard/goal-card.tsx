import Link from "next/link";

import { CustodianAssignmentForm } from "./custodian-assignment-form";
import { CancelCustodianRequestControl } from "./cancel-custodian-request-control";
import { EndCustodianRoleControl } from "./end-custodian-role-control";
import { CompleteGoalControl } from "./complete-goal-control";
import { ArchiveGoalControl } from "./archive-goal-control";
import type { OwnerCustodianAssignmentState } from "@/src/services/custodian.service";
import type { PersonalGoalDashboardSummary } from "@/src/services/goal.service";

export function GoalCard({
  goal,
  subdued = false,
  custodianState,
}: {
  goal: PersonalGoalDashboardSummary;
  subdued?: boolean;
  custodianState?: OwnerCustodianAssignmentState;
}) {
  const isArchived = goal.status === "ARCHIVED";

  return (
    <article
      className={`rounded-[1.5rem] border p-5 shadow-[0_8px_30px_rgba(77,57,40,0.06)] ${
        isArchived
          ? "border-[#e5ddd1] bg-[#f5f0e7] text-[#7b8179]"
          : subdued
            ? "border-[#e1d9cd] bg-[#fffaf2] text-[#587066]"
            : "border-[#dfd2c1] bg-[#fffdf8] text-[#173b32]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold leading-7 text-[#173b32]">{goal.name}</h3>
        {goal.status !== "ACTIVE" ? (
          <span className="shrink-0 rounded-full bg-[#eee5d8] px-3 py-1 text-xs font-semibold text-[#7b8179]">
            {goal.status === "COMPLETED" ? "Completed" : "Archived"}
          </span>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-[#173b32]">
            {formatGoalAmount(goal.weeklyAmount, goal.currency)}
            <span className="ml-1 text-sm font-medium text-[#7b8179]">/ week</span>
          </p>
          <p className="mt-1 text-sm text-[#7b8179]">Target: {formatGoalAmount(goal.targetAmount, goal.currency)}</p>
        </div>

        <div className="border-t border-[#e8dfd3] pt-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Saved</p>
              <p className="mt-1 text-lg font-semibold text-[#173b32]">{formatGoalAmount(goal.savedAmount, goal.currency)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Remaining</p>
              <p className="mt-1 text-sm font-semibold text-[#587066]">{formatGoalAmount(goal.remainingAmount, goal.currency)}</p>
            </div>
          </div>

          <div className="mt-4">
            <div
              aria-label={`${formatProgressPercent(goal.progressPercent)}% of target recorded`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.min(goal.progressPercent, 100)}
              className="h-2.5 overflow-hidden rounded-full bg-[#eee5d8]"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-[#c98268]"
                style={{ width: `${Math.min(goal.progressPercent, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-right text-sm font-medium text-[#587066]">
              {formatProgressPercent(goal.progressPercent)}% of target recorded
            </p>
          </div>
        </div>

        <div className="border-t border-[#e8dfd3] pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Unlocks</p>
          <time className="mt-1 block text-sm font-medium" dateTime={goal.unlockDate}>
            {formatGoalDate(goal.unlockDate)}
          </time>
        </div>

        <CompletionSection goal={goal} />

        <ArchiveSection goal={goal} />

        <CustodianSection goalId={goal.id} goalStatus={goal.status} state={custodianState} />

        {goal.status === "ACTIVE" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href={`/goals/${encodeURIComponent(goal.id)}/deposits/new`}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c98268] px-4 text-sm font-semibold text-[#a95f45] transition hover:bg-[#fff1e5] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
            >
              Record savings
            </Link>
            <Link
              href={`/goals/${encodeURIComponent(goal.id)}/deposits`}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#dfd2c1] px-4 text-sm font-semibold text-[#587066] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
            >
              View savings
            </Link>
          </div>
        ) : (
          <>
            <LifecycleSummary goal={goal} />
            <Link
              href={`/goals/${encodeURIComponent(goal.id)}/deposits`}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#dfd2c1] px-4 text-sm font-semibold text-[#587066] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
            >
              View savings
            </Link>
          </>
        )}
      </div>
    </article>
  );
}

function ArchiveSection({ goal }: { goal: PersonalGoalDashboardSummary }) {
  if (goal.status !== "COMPLETED") return null;

  if (goal.pendingDepositCount > 0) {
    return (
      <section className="border-t border-[#e8dfd3] pt-4" aria-labelledby={`archive-heading-${goal.id}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Archive</p>
        <h4 id={`archive-heading-${goal.id}`} className="mt-1 text-base font-semibold text-[#173b32]">
          This goal still has {goal.pendingDepositCount} {goal.pendingDepositCount === 1 ? "saving" : "savings"} waiting for confirmation.
        </h4>
        <p className="mt-2 text-sm leading-6 text-[#587066]">Resolve them before archiving this goal.</p>
        <Link
          href={`/goals/${encodeURIComponent(goal.id)}/deposits`}
          className="mt-3 inline-flex rounded-full px-1 py-2 text-sm font-semibold text-[#a95f45] transition hover:text-[#7b4838] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035]"
        >
          View savings waiting for confirmation
        </Link>
      </section>
    );
  }

  return (
    <section className="border-t border-[#e8dfd3] pt-4" aria-labelledby={`archive-heading-${goal.id}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Archive</p>
      <h4 id={`archive-heading-${goal.id}`} className="mt-1 text-base font-semibold text-[#173b32]">
        Keep this completed goal in your history.
      </h4>
      <p className="mt-2 text-sm leading-6 text-[#587066]">Your savings history will remain available.</p>
      <ArchiveGoalControl goalId={goal.id} />
    </section>
  );
}

function LifecycleSummary({ goal }: { goal: PersonalGoalDashboardSummary }) {
  if (goal.status === "COMPLETED") {
    return (
      <p className="text-sm leading-6 text-[#587066]">
        {goal.completedAt ? `Completed on ${formatGoalDate(goal.completedAt)}. ` : "Completed. "}
        Saved {formatGoalAmount(goal.savedAmount, goal.currency)} toward a target of {formatGoalAmount(goal.targetAmount, goal.currency)}.
      </p>
    );
  }

  if (goal.status === "ARCHIVED") {
    return (
      <p className="text-sm leading-6 text-[#7b8179]">
        {goal.completedAt ? `Completed ${formatGoalDate(goal.completedAt)}. ` : "Completed. "}
        {goal.archivedAt ? `Archived ${formatGoalDate(goal.archivedAt)}. ` : "Archived. "}
        Saved {formatGoalAmount(goal.savedAmount, goal.currency)} toward a target of {formatGoalAmount(goal.targetAmount, goal.currency)}.
      </p>
    );
  }

  return null;
}

function CompletionSection({ goal }: { goal: PersonalGoalDashboardSummary }) {
  if (goal.status !== "ACTIVE") return null;

  if (goal.completionEligible) {
    return (
      <section className="border-t border-[#e8dfd3] pt-4" aria-labelledby={`completion-heading-${goal.id}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Ready when you are</p>
        <h4 id={`completion-heading-${goal.id}`} className="mt-1 text-base font-semibold text-[#173b32]">
          You reached your target and your goal is now ready to complete.
        </h4>
        {goal.pendingDepositCount > 0 ? (
          <p className="mt-2 text-sm leading-6 text-[#587066]">
            You still have {goal.pendingDepositCount} {goal.pendingDepositCount === 1 ? "saving" : "savings"} waiting for confirmation. They can still be reviewed after you complete this goal.
          </p>
        ) : null}
        <CompleteGoalControl goalId={goal.id} />
      </section>
    );
  }

  if (goal.targetReached) {
    return (
      <p className="border-t border-[#e8dfd3] pt-4 text-sm leading-6 text-[#587066]">
        You reached your target. This goal unlocks on {formatGoalDate(goal.unlockDate)}.
      </p>
    );
  }

  if (goal.unlockDateReached) {
    return (
      <p className="border-t border-[#e8dfd3] pt-4 text-sm leading-6 text-[#587066]">
        Your goal is unlocked. Keep going until you reach your target.
      </p>
    );
  }

  return (
    <p className="border-t border-[#e8dfd3] pt-4 text-sm leading-6 text-[#587066]">
      Keep saving toward your target. This goal unlocks on {formatGoalDate(goal.unlockDate)}.
    </p>
  );
}

function CustodianSection({
  goalId,
  goalStatus,
  state,
}: {
  goalId: string;
  goalStatus: PersonalGoalDashboardSummary["status"];
  state?: OwnerCustodianAssignmentState;
}) {
  const current = state?.current ?? null;

  return (
    <section className="border-t border-[#e8dfd3] pt-4" aria-labelledby={`custodian-heading-${goalId}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Trusted person</p>
      <h4 id={`custodian-heading-${goalId}`} className="mt-1 text-base font-semibold text-[#173b32]">
        {current ? "Your savings accountability" : "Add someone you trust"}
      </h4>

      {current ? (
        <div className="mt-3 rounded-2xl bg-[#f7eee4] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[#173b32]">{current.displayName}</p>
              <p className="mt-1 break-all text-sm text-[#587066]">{current.email}</p>
            </div>
            <StatusPill status={current.status} />
          </div>
          <p className="mt-3 text-sm leading-6 text-[#587066]">
            {current.status === "PENDING"
              ? "Waiting for them to accept. Until they do, your deposits continue to be recorded normally without custodian confirmation."
              : "New deposits will wait for this person’s confirmation."}
          </p>
          {current.status === "PENDING" ? <CancelCustodianRequestControl assignmentId={current.id} /> : null}
          {current.status === "ACTIVE" ? <EndCustodianRoleControl assignmentId={current.id} /> : null}
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-[#587066]">
            Add someone you trust to confirm your savings when you record a deposit.
          </p>
          {state?.historical?.status === "DECLINED" ? (
            <p className="mt-2 text-sm font-medium text-[#a95f45]">Previous request declined.</p>
          ) : state?.historical?.status === "CANCELLED" ? (
            <p className="mt-2 text-sm font-medium text-[#a95f45]">Previous request cancelled.</p>
          ) : state?.historical?.status === "ENDED" ? (
            <p className="mt-2 text-sm font-medium text-[#587066]">Previous trusted-person role ended.</p>
          ) : null}
          {goalStatus === "ACTIVE" ? <CustodianAssignmentForm goalId={goalId} /> : null}
        </>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: "PENDING" | "ACTIVE" }) {
  return (
    <span className="rounded-full bg-[#fffaf0] px-3 py-1 text-xs font-semibold text-[#a95f45]">
      {status === "PENDING" ? "Awaiting acceptance" : "Active"}
    </span>
  );
}

function formatGoalAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}

function formatGoalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function formatProgressPercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
