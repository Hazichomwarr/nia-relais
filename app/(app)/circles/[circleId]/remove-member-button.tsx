"use client";

import { removeDraftCircleMemberAction } from "@/src/actions/circle.actions";

// A plain progressive-enhancement form bound directly to
// removeDraftCircleMemberAction (a single-FormData-argument action, not
// useActionState -- see that action's own comment). The only client-side
// behavior needed here is the explicit confirmation gate before removal;
// everything else (authorization, the actual removal, revalidation) is
// handled entirely server-side by the action itself.
export function RemoveMemberButton({
  circleId,
  memberId,
  displayName,
}: {
  circleId: string;
  memberId: string;
  displayName: string;
}) {
  return (
    <form
      action={removeDraftCircleMemberAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Remove ${displayName} from this circle? This can only be done while the circle is still a draft, and they will no longer be part of the active cohort.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="memberId" value={memberId} />
      <button
        type="submit"
        className="rounded-full border border-[#cdbda9] px-3 py-1.5 text-xs font-semibold text-[#8d4f42] transition-colors hover:border-[#a53f2b] hover:bg-[#f4e6e1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b96549]"
      >
        Remove
      </button>
    </form>
  );
}
