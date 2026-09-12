import type { CompletedCircleOwnerSummaryResult } from "@/src/services/circle-completed-owner.service";

import { getFrequencyLabel } from "../new/new-circle-form-display";
import { formatOwnerDate } from "./circle-workspace-display";

// Read-only. Renders exactly what getCompletedCircleSummaryForOwner
// returns -- circle identity/terms, the COMPLETED status, the completion
// timestamp, and the ordered member list. No round schedule, no
// contribution/payout figures, and no lifecycle/completion control of any
// kind -- this is the terminal historical counterpart to
// active-circle-summary.tsx, never a variant of it (7L.3: reusing the
// ACTIVE summary's "this circle is active... can no longer be changed"
// semantics for a circle that finished its entire rotation would be
// dishonest).
//
// Copy discipline (7L §30/7L.3 section 9): "Circle complete." / "All
// rotation rounds were closed and this circle was marked complete." --
// never "funds transferred," "payout completed by NIA," or any archive
// language (archive remains deferred, 7L §16).

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-[#173b32]">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function CompletedCircleSummary({ summary }: { summary: CompletedCircleOwnerSummaryResult }) {
  const { circle, members, memberCount } = summary;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">SUSU circles</p>
        <span className="mt-3 inline-flex w-fit rounded-full bg-[#efe7db] px-3 py-1 text-sm font-semibold text-[#587066]">
          COMPLETED
        </span>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{circle.name}</h1>
        <p className="mt-4 max-w-xl leading-7 text-[#587066]">
          Circle complete. All rotation rounds were closed and this circle was marked complete.
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Contribution</dt>
            <dd className="mt-1 text-base text-[#173b32]">
              {circle.currency} {circle.contributionAmount} · {getFrequencyLabel(circle.frequency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Started</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Completed</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.completedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">Members</dt>
            <dd className="mt-1 text-base text-[#173b32]">{memberCount}</dd>
          </div>
        </dl>
      </section>

      <Card title="Members, in payout order">
        <ol className="divide-y divide-[#efe6d8]">
          {members.map((member) => (
            <li key={member.id} className="py-2 text-sm text-[#173b32]">
              <span className="font-semibold">{member.payoutOrder}.</span> {member.displayName}{" "}
              <span className="text-xs text-[#7b8179]">({member.memberCode})</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
