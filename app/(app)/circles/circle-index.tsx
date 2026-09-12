import Link from "next/link";

import type { OwnerCircleIndexItem } from "@/src/services/circle-owner-index.service";

import { getFrequencyLabel } from "./new/new-circle-form-display";
import { formatOwnerDate, getRoundStatusBadge } from "./[circleId]/circle-workspace-display";

const STATUS_STYLES: Record<OwnerCircleIndexItem["status"], string> = {
  DRAFT: "bg-[#fff0d9] text-[#8a5b27]",
  ACTIVE: "bg-[#e6f0e8] text-[#35634f]",
  COMPLETED: "bg-[#efe7db] text-[#587066]",
};

function CircleCard({ circle }: { circle: OwnerCircleIndexItem }) {
  const round = circle.currentOrNextRound;
  const roundBadge = round ? getRoundStatusBadge(round.status) : null;

  return (
    <li className="rounded-[1.5rem] border border-[#dfd2c1] bg-[#fffdf8] p-5 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[circle.status]}`}>
            {circle.status}
          </span>
          <h2 className="mt-3 font-serif text-2xl tracking-tight text-[#173b32]">{circle.name}</h2>
        </div>
        <Link
          href={`/circles/${circle.id}`}
          className="rounded-full bg-[#173b32] px-4 py-2 text-sm font-semibold text-[#fffaf2] transition-colors hover:bg-[#285347] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
        >
          Open circle
        </Link>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Contribution</dt>
          <dd className="mt-1 text-[#173b32]">
            {circle.currency} {circle.contributionAmount} · {getFrequencyLabel(circle.frequency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Members</dt>
          <dd className="mt-1 text-[#173b32]">{circle.memberCount}</dd>
        </div>
      </dl>

      {round ? (
        <div className="mt-5 rounded-xl bg-[#f7eee4] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {roundBadge ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${roundBadge.className}`}>{roundBadge.label}</span> : null}
            <p className="text-sm font-semibold text-[#173b32]">
              {round.status === "ACTIVE" ? "Current round" : "Next round"}: {round.roundNumber} · {round.recipientDisplayName}
            </p>
          </div>
          <p className="mt-1 text-xs text-[#587066]">Scheduled for {formatOwnerDate(round.dueDate)}</p>
        </div>
      ) : null}
    </li>
  );
}

export function CircleIndex({ circles }: { circles: readonly OwnerCircleIndexItem[] }) {
  const groups = (["DRAFT", "ACTIVE", "COMPLETED"] as const).map((status) => ({
    status,
    circles: circles.filter((circle) => circle.status === status),
  }));

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#fbf7ef] px-5 py-10 text-[#173b32] sm:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circles</p>
            <h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">My SUSU circles</h1>
            <p className="mt-3 max-w-2xl leading-7 text-[#587066]">Return to a circle, see where it stands, and continue its next step.</p>
          </div>
          <Link href="/circles/new" className="rounded-full bg-[#b96549] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#9e513b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173b32]">
            + Create a circle
          </Link>
        </div>

        {circles.length === 0 ? (
          <section className="mt-8 rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-7 text-center shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-10">
            <h2 className="font-serif text-2xl tracking-tight">No circles yet</h2>
            <p className="mx-auto mt-3 max-w-md leading-7 text-[#587066]">Create a draft circle when you are ready to plan a shared savings rotation.</p>
          </section>
        ) : (
          <div className="mt-9 space-y-10">
            {groups.map((group) => group.circles.length > 0 ? (
              <section key={group.status} aria-labelledby={`${group.status.toLowerCase()}-circles`}>
                <h2 id={`${group.status.toLowerCase()}-circles`} className="text-sm font-semibold uppercase tracking-[0.16em] text-[#587066]">{group.status}</h2>
                <ul className="mt-4 grid gap-4 lg:grid-cols-2">
                  {group.circles.map((circle) => <CircleCard key={circle.id} circle={circle} />)}
                </ul>
              </section>
            ) : null)}
          </div>
        )}
      </div>
    </main>
  );
}
