import Link from "next/link";

import { requireUser } from "@/src/auth/require-user";
import { getCustodianAssignmentStatesForOwner } from "@/src/services/custodian.service";
import { getCustodianInboxForUser } from "@/src/services/custodian.service";
import { getPendingDepositsForCustodian } from "@/src/services/custodian-deposit.service";
import { getPersonalGoalsForDashboard } from "@/src/services/goal.service";
import { EmptyGoalsState } from "./empty-goals-state";
import { GoalCard } from "./goal-card";
import { TrustedPersonDashboardCard } from "./trusted-person-dashboard-card";

const copy = {
  welcome: "Welcome back",
  subtitle: "A little consistency can make room for something meaningful.",
  active: "Your active goals",
  completed: "Completed goals",
  archived: "Archived goals",
  newGoal: "New goal",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const goals = await getPersonalGoalsForDashboard(user);
  const [custodianStates, custodianAssignments, pendingDeposits] = await Promise.all([
    getCustodianAssignmentStatesForOwner(user.id, goals.map((goal) => goal.id)),
    getCustodianInboxForUser(user.id),
    getPendingDepositsForCustodian(user.id),
  ]);
  const activeGoals = goals.filter((goal) => goal.status === "ACTIVE");
  const completedGoals = goals.filter((goal) => goal.status === "COMPLETED");
  const archivedGoals = goals.filter((goal) => goal.status === "ARCHIVED");
  const pendingInvitations = custodianAssignments.filter((assignment) => assignment.status === "PENDING");
  const activeAssignments = custodianAssignments.filter((assignment) => assignment.status === "ACTIVE");
  const hasHistoricalAssignments = custodianAssignments.some(
    (assignment) => assignment.status === "DECLINED" || assignment.status === "CANCELLED" || assignment.status === "ENDED",
  );
  const hasCustodianContext = pendingInvitations.length > 0 || activeAssignments.length > 0 || pendingDeposits.length > 0 || hasHistoricalAssignments;

  return (
    <div className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a95f45]">NIA</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {copy.welcome}, {user.name}
            </h1>
            <p className="mt-3 max-w-md text-base leading-7 text-[#587066]">{copy.subtitle}</p>
          </div>

          <Link
            href="/goals/new"
            className="inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-[#b96549] px-5 font-semibold text-white shadow-sm transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
          >
            {copy.newGoal}
          </Link>
        </header>

        <TrustedPersonDashboardCard
          pendingInvitations={pendingInvitations}
          activeAssignments={activeAssignments}
          pendingDeposits={pendingDeposits}
          hasHistoricalAssignments={hasHistoricalAssignments}
        />

        {goals.length === 0 ? (
          <div className={hasCustodianContext ? "mt-8" : ""}>
            <EmptyGoalsState />
          </div>
        ) : (
          <div className="mt-12 space-y-12">
            {activeGoals.length > 0 ? (
              <GoalSection heading={copy.active}>
                {activeGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} custodianState={custodianStates.get(goal.id)} />
                ))}
              </GoalSection>
            ) : null}

            {completedGoals.length > 0 ? (
              <GoalSection heading={copy.completed} subdued>
                {completedGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} subdued custodianState={custodianStates.get(goal.id)} />
                ))}
              </GoalSection>
            ) : null}

            {archivedGoals.length > 0 ? (
              <GoalSection heading={copy.archived} subdued>
                {archivedGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} subdued custodianState={custodianStates.get(goal.id)} />
                ))}
              </GoalSection>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function GoalSection({
  children,
  heading,
  subdued = false,
}: {
  children: React.ReactNode;
  heading: string;
  subdued?: boolean;
}) {
  return (
    <section aria-labelledby={`${heading.toLowerCase().replaceAll(" ", "-")}-heading`}>
      <h2
        id={`${heading.toLowerCase().replaceAll(" ", "-")}-heading`}
        className={`text-xl font-semibold tracking-tight ${subdued ? "text-[#587066]" : "text-[#173b32]"}`}
      >
        {heading}
      </h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}
