import { notFound } from "next/navigation";

import {
  GoalNotFoundOrUnauthorizedError,
  requireGoalOwner,
} from "@/src/auth/require-goal-owner";
import DepositForm from "./deposit-form";

export default async function NewDepositPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const { goalId } = await params;
  let authority;

  try {
    authority = await requireGoalOwner(goalId);
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) notFound();
    throw error;
  }

  const { goal } = authority;

  if (goal.status !== "ACTIVE") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-12">
        <div className="mx-auto w-full max-w-xl rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-7 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{goal.name}</p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">This goal is not accepting new savings.</h1>
          <p className="mt-3 text-base leading-7 text-[#587066]">You can still view it from your dashboard.</p>
        </div>
      </main>
    );
  }

  return (
    <DepositForm
      goal={{
        name: goal.name,
        currency: goal.currency,
        weeklyAmount: goal.weeklyAmount.toFixed(2),
        startDate: goal.startDate.toISOString().slice(0, 10),
      }}
      goalId={goal.id}
    />
  );
}
