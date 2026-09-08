import { requireUser } from "@/src/auth/require-user";
import {
  getCustodianInboxForUser,
  type CustodianInboxItem,
} from "@/src/services/custodian.service";
import { getPendingDepositsForCustodian } from "@/src/services/custodian-deposit.service";
import { CustodianAssignmentCard } from "./custodian-assignment-card";
import {
  CustodianInboxFilters,
  type AssignmentRangeFilter,
  type AssignmentStatusFilter,
} from "./custodian-inbox-filters";
import { CustodianPendingDepositCard } from "./custodian-pending-deposit-card";
import { CustodianRelationshipRow, lifecycleEvent } from "./custodian-relationship-row";

type CustodianSearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusFilters = new Set<AssignmentStatusFilter>([
  "all",
  "PENDING",
  "ACTIVE",
  "DECLINED",
  "CANCELLED",
  "ENDED",
]);
const rangeFilters = new Set<AssignmentRangeFilter>(["all", "30d", "90d", "year"]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatusFilter(value: string | string[] | undefined): AssignmentStatusFilter {
  const candidate = firstValue(value);
  return candidate && statusFilters.has(candidate as AssignmentStatusFilter)
    ? candidate as AssignmentStatusFilter
    : "all";
}

function parseRangeFilter(value: string | string[] | undefined): AssignmentRangeFilter {
  const candidate = firstValue(value);
  return candidate && rangeFilters.has(candidate as AssignmentRangeFilter)
    ? candidate as AssignmentRangeFilter
    : "all";
}

function dateIsInRange(value: Date, range: AssignmentRangeFilter) {
  if (range === "all") return true;

  const now = new Date();
  if (range === "year") {
    return value >= new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) && value <= now;
  }

  const minimum = new Date(now);

  if (range === "30d") minimum.setUTCDate(now.getUTCDate() - 30);
  if (range === "90d") minimum.setUTCDate(now.getUTCDate() - 90);

  return value >= minimum && value <= now;
}

function sortByLatestLifecycleEvent(assignments: CustodianInboxItem[]) {
  return [...assignments].sort((left, right) => {
    const timestampDifference = lifecycleEvent(right).getTime() - lifecycleEvent(left).getTime();
    return timestampDifference || right.id.localeCompare(left.id);
  });
}

export default async function CustodianPage({
  searchParams,
}: {
  searchParams: CustodianSearchParams;
}) {
  const user = await requireUser();
  const filters = await searchParams;
  const status = parseStatusFilter(filters.status);
  const range = parseRangeFilter(filters.range);
  const [assignments, pendingDeposits] = await Promise.all([
    getCustodianInboxForUser(user.id),
    getPendingDepositsForCustodian(user.id),
  ]);
  const pendingInvitations = assignments
    .filter((assignment) => assignment.status === "PENDING")
    .sort((left, right) => lifecycleEvent(left).getTime() - lifecycleEvent(right).getTime() || left.id.localeCompare(right.id));
  const activeRelationships = sortByLatestLifecycleEvent(assignments.filter((assignment) => assignment.status === "ACTIVE"));
  const terminalAssignments = assignments.filter(
    (assignment) => assignment.status === "DECLINED" || assignment.status === "CANCELLED" || assignment.status === "ENDED",
  );
  const relationshipRecords = status === "all" ? terminalAssignments : assignments.filter((assignment) => assignment.status === status);
  const filteredRelationships = sortByLatestLifecycleEvent(
    relationshipRecords.filter((assignment) => dateIsInRange(lifecycleEvent(assignment), range)),
  );
  const noActivity = assignments.length === 0;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#f8f1e4] px-4 py-8 text-[#173c35] sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b95035]">Trusted person</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">A little trust goes a long way.</h1>
          <p className="mt-4 text-base leading-7 text-[#5a6b61]">
            People you know may ask you to confirm that their recorded savings happened. NIA does not hold or move the money.
          </p>
        </header>

        <dl className="mt-8 grid gap-3 sm:grid-cols-3">
          <SummaryCount label="Invitations" value={pendingInvitations.length} />
          <SummaryCount label="Awaiting confirmation" value={pendingDeposits.length} />
          <SummaryCount label="Active relationships" value={activeRelationships.length} />
        </dl>

        <section className="mt-10" aria-labelledby="attention-heading">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#b95035]">Needs your attention</p>
          <h2 id="attention-heading" className="mt-2 text-2xl font-semibold tracking-tight">What needs you today</h2>

          <div className="mt-5 space-y-6">
            {pendingInvitations.length > 0 ? (
              <section aria-labelledby="invitations-heading">
                <h3 id="invitations-heading" className="text-lg font-semibold">Invitations waiting for you</h3>
                <div className="mt-4 space-y-4">
                  {pendingInvitations.map((assignment) => <CustodianAssignmentCard key={assignment.id} assignment={assignment} />)}
                </div>
              </section>
            ) : null}

            <section aria-labelledby="deposits-heading">
              <h3 id="deposits-heading" className="text-lg font-semibold">Deposits awaiting confirmation</h3>
              {pendingDeposits.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-[#d7e5d7] bg-[#edf5eb] p-5 text-sm leading-6 text-[#315b4b]">
                  You&apos;re all caught up.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm font-semibold text-[#315b4b]">
                    {pendingDeposits.length} deposit{pendingDeposits.length === 1 ? " is" : "s are"} waiting for your confirmation.
                  </p>
                  <div className="mt-4 space-y-4">
                    {pendingDeposits.map((deposit) => <CustodianPendingDepositCard key={deposit.id} deposit={deposit} />)}
                  </div>
                </>
              )}
            </section>
          </div>
        </section>

        {activeRelationships.length > 0 ? (
          <section className="mt-10" aria-labelledby="relationships-heading">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">Your trusted-person relationships</p>
            <h2 id="relationships-heading" className="mt-2 text-2xl font-semibold tracking-tight">People you&apos;re helping</h2>
            <div className="mt-5 space-y-3">
              {activeRelationships.map((assignment) => <CustodianRelationshipRow key={assignment.id} assignment={assignment} />)}
            </div>
          </section>
        ) : null}

        <section className="mt-10" aria-labelledby="history-heading">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7b8179]">History and filters</p>
          <h2 id="history-heading" className="mt-2 text-2xl font-semibold tracking-tight">Your trusted-person activity</h2>

          {noActivity ? (
            <div className="mt-5 rounded-[1.75rem] border border-[#e4d6c4] bg-[#fffaf0] p-7 shadow-[0_12px_30px_rgba(23,60,53,0.07)]">
              <p className="text-xl font-semibold">You&apos;re not someone&apos;s trusted person yet.</p>
              <p className="mt-2 max-w-lg text-sm leading-6 text-[#5a6b61]">When someone asks for your support, their invitation and any savings awaiting confirmation will appear here.</p>
            </div>
          ) : (
            <>
              <CustodianInboxFilters status={status} range={range} />
              {filteredRelationships.length === 0 ? (
                <p className="mt-5 rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-5 text-sm leading-6 text-[#5a6b61]">
                  No trusted-person activity matches these filters.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {filteredRelationships.map((assignment) => <CustodianRelationshipRow key={assignment.id} assignment={assignment} />)}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7b8179]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-[#173c35]">{value}</dd>
    </div>
  );
}
