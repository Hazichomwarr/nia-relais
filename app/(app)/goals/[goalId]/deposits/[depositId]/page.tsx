import Link from "next/link";
import { notFound } from "next/navigation";

import {
  GoalNotFoundOrUnauthorizedError,
  requireGoalOwner,
} from "@/src/auth/require-goal-owner";
import { getDepositDetailForGoal } from "@/src/services/deposit.service";

import {
  formatDecisionDate,
  formatDepositAmount,
  formatDepositDate,
  getDepositStatusPresentation,
} from "../deposit-display";

export default async function DepositDetailPage({
  params,
}: {
  params: Promise<{ goalId: string; depositId: string }>;
}) {
  const { goalId, depositId } = await params;
  let authority;

  try {
    authority = await requireGoalOwner(goalId);
  } catch (error) {
    if (error instanceof GoalNotFoundOrUnauthorizedError) notFound();
    throw error;
  }

  const deposit = await getDepositDetailForGoal(authority.goal.id, depositId);
  if (!deposit) notFound();

  const status = getDepositStatusPresentation(deposit);

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-8 text-[#173b32] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href={`/goals/${encodeURIComponent(authority.goal.id)}/deposits`}
          className="inline-flex items-center gap-2 rounded-full px-1 py-2 text-sm font-semibold text-[#587066] transition hover:text-[#173b32] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549]"
        >
          <span aria-hidden="true">←</span>
          Back to savings
        </Link>

        <header className="mt-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">Saving record</p>
          <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
            {authority.goal.name}
          </h1>
        </header>

        <section className="mt-7 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <p className="break-all text-4xl font-semibold tracking-tight text-[#173b32] sm:text-5xl">
              {formatDepositAmount(deposit.amount, authority.goal.currency)}
            </p>
            <span className={`w-fit rounded-full px-3 py-1 text-sm font-semibold ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#587066]">{status.description}</p>
        </section>

        <DetailSection title="Record details">
          <DetailList>
            <DetailRow label="Goal ID" value={deposit.goalId} breakable />
            <DetailRow label="Recorded on" value={formatDepositDate(deposit.depositDate)} />
            <DetailRow label="Added to NIA" value={formatDecisionDate(deposit.createdAt)} />
            <DetailRow label="Recorded by" value={deposit.recordedByName} />
            <DetailRow label="Record ID" value={deposit.id} breakable />
          </DetailList>
        </DetailSection>

        <DetailSection title="Verification details">
          {deposit.verificationMode === "OWNER" ? (
            <div className="space-y-4">
              <p className="leading-7 text-[#587066]">
                Confirmed when recorded. No trusted person was assigned to verify this saving.
              </p>
              <DetailList>
                <DetailRow label="Verification method" value="Confirmed when recorded" />
                {deposit.approvedAt ? <DetailRow label="Confirmed on" value={formatDecisionDate(deposit.approvedAt)} /> : null}
                {deposit.approvedByName ? <DetailRow label="Confirmed by" value={deposit.approvedByName} /> : null}
              </DetailList>
            </div>
          ) : deposit.status === "PENDING" ? (
            <div className="space-y-2 leading-7 text-[#587066]">
              <p>Waiting for your trusted person to confirm this saving.</p>
              <p>Verification method: trusted person confirmation.</p>
              {deposit.responsibleCustodianName ? (
                <p>
                  Responsible person: <span className="font-semibold text-[#173b32]">{deposit.responsibleCustodianName}</span>
                </p>
              ) : null}
            </div>
          ) : deposit.status === "APPROVED" ? (
            <DetailList>
              <DetailRow label="Verification method" value="Trusted person confirmation" />
              <DetailRow label="Confirmed on" value={deposit.approvedAt ? formatDecisionDate(deposit.approvedAt) : "Confirmed"} />
              {deposit.approvedByName ? <DetailRow label="Confirmed by" value={deposit.approvedByName} /> : null}
              {deposit.responsibleCustodianName ? <DetailRow label="Responsible person" value={deposit.responsibleCustodianName} /> : null}
            </DetailList>
          ) : (
            <DetailList>
              <DetailRow label="Verification method" value="Trusted person confirmation" />
              <DetailRow label="Not confirmed on" value={deposit.rejectedAt ? formatDecisionDate(deposit.rejectedAt) : "Not confirmed"} />
              {deposit.rejectedByName ? <DetailRow label="Reviewed by" value={deposit.rejectedByName} /> : null}
              {deposit.responsibleCustodianName ? <DetailRow label="Responsible person" value={deposit.responsibleCustodianName} /> : null}
              {deposit.rejectionReason ? <DetailRow label="Reason" value={deposit.rejectionReason} breakable /> : null}
            </DetailList>
          )}
        </DetailSection>

        {deposit.note ? (
          <DetailSection title="Note">
            <p className="whitespace-pre-wrap break-words leading-7 text-[#587066]">{deposit.note}</p>
          </DetailSection>
        ) : null}
      </div>
    </main>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-[1.5rem] border border-[#dfd2c1] bg-[#fffaf2] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.05)] sm:p-7">
      <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailList({ children }: { children: React.ReactNode }) {
  return <dl className="space-y-4">{children}</dl>;
}

function DetailRow({
  label,
  value,
  breakable = false,
}: {
  label: string;
  value: string;
  breakable?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-[#587066]">{label}</dt>
      <dd className={`text-sm leading-6 text-[#173b32] ${breakable ? "break-words" : ""}`}>{value}</dd>
    </div>
  );
}
