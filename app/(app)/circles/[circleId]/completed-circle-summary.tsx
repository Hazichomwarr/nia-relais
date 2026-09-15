import type { CompletedCircleOwnerSummaryResult } from "@/src/services/circle-completed-owner.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

import { getFrequencyLabel } from "@/src/i18n/format";
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

export function CompletedCircleSummary({ summary, dictionary, locale }: { summary: CompletedCircleOwnerSummaryResult; dictionary: Dictionary; locale: Locale }) {
  const { circle, members, memberCount } = summary;
  const copy = dictionary.susuOwner;
  const isImported = circle.originKind === "IMPORTED";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <section className="rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#a95f45]">{copy.circlesEyebrow}</p>
        <span className="mt-3 inline-flex w-fit rounded-full bg-[#efe7db] px-3 py-1 text-sm font-semibold text-[#587066]">
          {dictionary.susuWorkspace.completed}
        </span>
        <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{circle.name}</h1>
        <p className="mt-4 max-w-xl leading-7 text-[#587066]">
          {copy.completedCircleDescription}
        </p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.contribution}</dt>
            <dd className="mt-1 text-base text-[#173b32]">
              {circle.currency} {circle.contributionAmount} · {getFrequencyLabel(circle.frequency, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.started}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.completed}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{formatOwnerDate(circle.completedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#7b8179]">{copy.members}</dt>
            <dd className="mt-1 text-base text-[#173b32]">{memberCount}</dd>
          </div>
        </dl>
      </section>

      {isImported ? (
        <section className="rounded-2xl border border-[#dbe2d6] bg-[#eef1ea] p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex w-fit rounded-full bg-[#e3e8df] px-3 py-1 text-xs font-semibold text-[#4f6354]">
              {copy.importedCircleContextTitle}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#4f6354]">
            {copy.importedCircleContextDescription.replace("{count}", String(circle.historicalCompletedRoundCount))}
          </p>
        </section>
      ) : null}

      <Card title={`${copy.members}, ${copy.payoutOrder.toLocaleLowerCase()}`}>
        <ol className="divide-y divide-[#efe6d8]">
          {members.map((member) => (
            <li key={member.id} className="py-2 text-sm text-[#173b32]">
              <span className="font-semibold">{member.payoutOrder}.</span> {member.displayName}{" "}
              {member.phone ? <span className="ml-2 text-xs text-[#7b8179]">{dictionary.susu.phoneNumber}: {member.phone}</span> : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
