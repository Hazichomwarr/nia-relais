type Member = {
  readonly id: string;
  readonly displayName: string;
  readonly memberCode: string;
  readonly phone: string | null;
  readonly payoutOrder: number | null;
};

import type { Dictionary } from "@/src/i18n/dictionaries/types";

export function CircleMemberReadList({ members, dictionary }: { members: readonly Member[]; dictionary: Dictionary }) {
  const copy = dictionary.susuOwner;
  return (
    <section className="max-w-3xl rounded-[1.75rem] border border-[#dfd2c1] bg-[#fffdf8] p-6 shadow-[0_8px_30px_rgba(77,57,40,0.06)] sm:p-8">
      <h1 className="font-serif text-3xl tracking-tight">{copy.members}</h1>
      <p className="mt-3 text-sm leading-6 text-[#587066]">{copy.activeMembershipDescription}</p>
      <ol className="mt-6 divide-y divide-[#efe6d8]">
        {members.map((member, index) => (
          <li key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#dce9dc] text-sm font-semibold text-[#173b32]">{member.payoutOrder ?? index + 1}</span>
            <div><p className="font-semibold text-[#173b32]">{member.displayName}</p><p className="text-xs text-[#7b8179]">{copy.activeMember}</p>{member.phone ? <p className="mt-1 text-xs text-[#7b8179]">{dictionary.susu.phoneNumber}: {member.phone}</p> : null}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
