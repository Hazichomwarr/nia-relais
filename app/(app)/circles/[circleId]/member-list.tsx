import type { DraftCircleOwnerMemberResult } from "@/src/services/circle-draft-owner.service";

import { formatOwnerDate, getMemberStatusBadgeLabel } from "./circle-workspace-display";
import { RemoveMemberButton } from "./remove-member-button";

// Renders exactly the fields getDraftCircleForOwner already returns --
// displayName, email, memberCode, status, payoutOrder, addedAt, removedAt.
// Never pinHash, credentialVersion, lockout state, session rows, or
// internal actor ids (addedById/removedById): those were never selected
// by the service in the first place, so there is nothing here that could
// accidentally render them. Removed members are shown as history, never
// offered a reactivation control.

export function MemberList({
  circleId,
  members,
}: {
  circleId: string;
  members: readonly DraftCircleOwnerMemberResult[];
}) {
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const removedMembers = members.filter((member) => member.status === "REMOVED");

  if (members.length === 0) {
    return <p className="text-sm leading-6 text-[#587066]">No members yet. Add the first person you trust below.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#7b8179]">Active members</h3>
        {activeMembers.length === 0 ? (
          <p className="mt-2 text-sm text-[#587066]">No active members yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#efe6d8]">
            {activeMembers.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#173b32]">{member.displayName}</p>
                  <p className="text-xs text-[#7b8179]">
                    {member.email ? `${member.email} · ` : ""}Code: {member.memberCode}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex w-fit rounded-full bg-[#e6f0e8] px-3 py-1 text-xs font-semibold text-[#35634f]">
                    {getMemberStatusBadgeLabel(member.status)}
                  </span>
                  <RemoveMemberButton circleId={circleId} memberId={member.id} displayName={member.displayName} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {removedMembers.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#7b8179]">Removed (history)</h3>
          <ul className="mt-3 divide-y divide-[#efe6d8]">
            {removedMembers.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between opacity-75">
                <div>
                  <p className="text-sm font-semibold text-[#173b32]">{member.displayName}</p>
                  <p className="text-xs text-[#7b8179]">
                    Code: {member.memberCode}
                    {member.removedAt ? ` · Removed ${formatOwnerDate(member.removedAt)}` : ""}
                  </p>
                </div>
                <span className="inline-flex w-fit rounded-full bg-[#efe7db] px-3 py-1 text-xs font-semibold text-[#587066]">
                  {getMemberStatusBadgeLabel(member.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
