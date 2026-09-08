import { requireUser } from "@/src/auth/require-user";
import { getCustodianInboxForUser } from "@/src/services/custodian.service";
import { getPendingDepositsForCustodian } from "@/src/services/custodian-deposit.service";
import { CustodianPendingDepositCard } from "./custodian-pending-deposit-card";
import { CustodianAssignmentCard } from "./custodian-assignment-card";

export default async function CustodianPage() {
  const user = await requireUser();
  const [assignments, pendingDeposits] = await Promise.all([
    getCustodianInboxForUser(user.id),
    getPendingDepositsForCustodian(user.id),
  ]);
  const pending = assignments.filter((assignment) => assignment.status === "PENDING");
  const history = assignments.filter((assignment) => assignment.status !== "PENDING");

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#f8f1e4] px-4 py-8 text-[#173c35] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b95035]">Trusted requests</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">A little trust goes a long way.</h1>
          <p className="mt-4 text-base leading-7 text-[#5a6b61]">
            People you know may ask you to confirm that their recorded savings happened. NIA does not hold or move the money.
          </p>
        </header>

        {assignments.length === 0 ? (
          <section className="mt-8 rounded-[2rem] border border-[#e4d6c4] bg-[#fffaf0] p-7 shadow-[0_12px_30px_rgba(23,60,53,0.07)]" aria-labelledby="empty-heading">
            <p className="text-3xl" aria-hidden="true">☀︎</p>
            <h2 id="empty-heading" className="mt-4 text-2xl font-semibold">No trusted-person requests right now.</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-[#5a6b61]">When someone asks you to support their savings goal, their request will appear here.</p>
          </section>
        ) : (
          <div className="mt-8 space-y-10">
            {pending.length > 0 ? (
              <section aria-labelledby="pending-heading">
                <h2 id="pending-heading" className="text-2xl font-semibold">Requests waiting for you</h2>
                <div className="mt-4 space-y-4">
                  {pending.map((assignment) => <CustodianAssignmentCard key={assignment.id} assignment={assignment} />)}
                </div>
              </section>
            ) : null}

            {history.length > 0 ? (
              <section aria-labelledby="history-heading">
                <h2 id="history-heading" className="text-xl font-semibold text-[#5a6b61]">Your trusted-person history</h2>
                <div className="mt-4 space-y-4">
                  {history.map((assignment) => <CustodianAssignmentCard key={assignment.id} assignment={assignment} />)}
                </div>
              </section>
            ) : null}

            <section aria-labelledby="deposits-heading">
              <h2 id="deposits-heading" className="text-2xl font-semibold">Deposits awaiting confirmation</h2>
              {pendingDeposits.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-5 text-sm leading-6 text-[#5a6b61]">
                  No deposits need your confirmation right now.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {pendingDeposits.map((deposit) => (
                    <CustodianPendingDepositCard key={deposit.id} deposit={deposit} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {assignments.length === 0 ? (
          <section className="mt-10" aria-labelledby="deposits-heading-empty">
            <h2 id="deposits-heading-empty" className="text-2xl font-semibold">Deposits awaiting confirmation</h2>
            {pendingDeposits.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-5 text-sm leading-6 text-[#5a6b61]">
                No deposits need your confirmation right now.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {pendingDeposits.map((deposit) => (
                  <CustodianPendingDepositCard key={deposit.id} deposit={deposit} />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
