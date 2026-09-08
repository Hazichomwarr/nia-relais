import Link from "next/link";

import type { CustodianInboxItem } from "@/src/services/custodian.service";
import type { PendingCustodianDeposit } from "@/src/services/custodian-deposit.service";

type TrustedPersonDashboardCardProps = {
  pendingInvitations: CustodianInboxItem[];
  activeAssignments: CustodianInboxItem[];
  pendingDeposits: PendingCustodianDeposit[];
  hasHistoricalAssignments: boolean;
};

export function TrustedPersonDashboardCard({
  pendingInvitations,
  activeAssignments,
  pendingDeposits,
  hasHistoricalAssignments,
}: TrustedPersonDashboardCardProps) {
  const attentionRequired = pendingInvitations.length > 0 || pendingDeposits.length > 0;
  const activeAssignment = activeAssignments[0] ?? null;
  const historicalDeposit = pendingDeposits[0] ?? null;

  if (!attentionRequired && !activeAssignment && !hasHistoricalAssignments) return null;

  return (
    <section className="mt-10 space-y-3" aria-labelledby="trusted-person-dashboard-heading">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">Trusted person</p>
          <h2 id="trusted-person-dashboard-heading" className="mt-2 text-2xl font-semibold tracking-tight text-[#173b32]">
            A little trust goes a long way.
          </h2>
        </div>
      </div>

      {pendingInvitations.length > 0 ? (
        <article className="rounded-[1.5rem] border border-[#e6c6ae] bg-[#fff4e8] p-5 shadow-[0_8px_30px_rgba(132,83,63,0.07)] sm:p-6">
          <p className="text-lg font-semibold text-[#173b32]">You&apos;ve been invited to help someone stay accountable.</p>
          <p className="mt-2 text-sm leading-6 text-[#587066]">
            {pendingInvitations[0].ownerName} invited you to be a trusted person for {pendingInvitations[0].goal.name}.
            {pendingInvitations.length > 1 ? ` You have ${pendingInvitations.length - 1} more invitation${pendingInvitations.length === 2 ? "" : "s"}.` : ""}
          </p>
          <Link
            href="/custodian"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
          >
            View invitation
          </Link>
        </article>
      ) : null}

      {activeAssignment || pendingDeposits.length > 0 ? (
        <article className="rounded-[1.5rem] border border-[#cfe0d0] bg-[#edf5eb] p-5 shadow-[0_8px_30px_rgba(49,91,75,0.06)] sm:p-6">
          <p className="text-lg font-semibold text-[#173b32]">
            {activeAssignment ? "You’re helping someone stay on track." : "A savings confirmation needs your attention."}
          </p>
          <p className="mt-2 text-sm leading-6 text-[#587066]">
            {activeAssignment
              ? `${activeAssignment.ownerName} is saving toward ${activeAssignment.goal.name}.`
              : `${historicalDeposit?.ownerName} has savings waiting for your confirmation.`}
          </p>
          {pendingDeposits.length > 0 ? (
            <p className="mt-3 text-sm font-semibold text-[#315b4b]">
              {pendingDeposits.length} savings deposit{pendingDeposits.length === 1 ? " is" : "s are"} waiting for your confirmation.
            </p>
          ) : (
            <p className="mt-3 text-sm font-semibold text-[#315b4b]">You&apos;re all caught up.</p>
          )}
          <Link
            href="/custodian"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-[#a9c5b0] px-5 text-sm font-semibold text-[#315b4b] transition hover:bg-[#e1efdf] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
          >
            Review savings
          </Link>
        </article>
      ) : null}

      {!attentionRequired && !activeAssignment && hasHistoricalAssignments ? (
        <article className="rounded-2xl border border-[#dfd2c1] bg-[#fffaf2] p-4 text-sm text-[#587066]">
          <p className="font-semibold text-[#173b32]">Your trusted-person history is here.</p>
          <p className="mt-1 leading-6">Past relationships and decisions remain available whenever you need them.</p>
          <Link href="/custodian" className="mt-3 inline-flex font-semibold text-[#a95f45] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]">
            View history
          </Link>
        </article>
      ) : null}
    </section>
  );
}
