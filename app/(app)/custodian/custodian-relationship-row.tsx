import type { CustodianInboxItem } from "@/src/services/custodian.service";

export function CustodianRelationshipRow({ assignment }: { assignment: CustodianInboxItem }) {
  const event = lifecycleEvent(assignment);

  return (
    <article className="rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">{statusLabel(assignment.status)}</p>
          <h3 className="mt-1 text-lg font-semibold text-[#173c35]">{assignment.goal.name}</h3>
          <p className="mt-1 text-sm text-[#5a6b61]">{relationshipCopy(assignment)}</p>
        </div>
        <time dateTime={event.toISOString()} className="text-sm text-[#7b8179]">{formatDate(event)}</time>
      </div>
    </article>
  );
}

export function lifecycleEvent(assignment: CustodianInboxItem) {
  const timestamp = assignment.status === "PENDING"
    ? assignment.assignedAt
    : assignment.status === "ACTIVE"
      ? assignment.acceptedAt ?? assignment.assignedAt
      : assignment.status === "DECLINED"
        ? assignment.declinedAt ?? assignment.assignedAt
        : assignment.status === "CANCELLED"
          ? assignment.cancelledAt ?? assignment.assignedAt
          : assignment.endedAt ?? assignment.assignedAt;

  return new Date(timestamp);
}

function relationshipCopy(assignment: CustodianInboxItem) {
  return assignment.status === "PENDING"
    ? `${assignment.ownerName} invited you to be their trusted person.`
    : assignment.status === "ACTIVE"
      ? `You're helping ${assignment.ownerName} stay consistent.`
      : assignment.status === "DECLINED"
        ? `You declined ${assignment.ownerName}'s request.`
        : assignment.status === "CANCELLED"
          ? `${assignment.ownerName} withdrew this request.`
          : `Your trusted-person role with ${assignment.ownerName} ended.`;
}

function statusLabel(status: CustodianInboxItem["status"]) {
  return status === "PENDING"
    ? "Invitation"
    : status === "ACTIVE"
      ? "Active relationship"
      : status === "DECLINED"
        ? "Declined"
        : status === "CANCELLED"
          ? "Cancelled"
          : "Ended";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}
