import type { CustodianInboxItem } from "@/src/services/custodian.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";

export function CustodianRelationshipRow({ assignment, dictionary, locale }: { assignment: CustodianInboxItem; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.custodian;
  const event = lifecycleEvent(assignment);

  return (
    <article className="rounded-2xl border border-[#e4d6c4] bg-[#fffaf0] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">{statusLabel(assignment.status, copy)}</p>
          <h3 className="mt-1 text-lg font-semibold text-[#173c35]">{assignment.goal.name}</h3>
          <p className="mt-1 text-sm text-[#5a6b61]">{relationshipCopy(assignment, copy)}</p>
        </div>
        <time dateTime={event.toISOString()} className="text-sm text-[#7b8179]">{formatDate(event, locale)}</time>
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

function relationshipCopy(assignment: CustodianInboxItem, copy: Dictionary["custodian"]) {
  return assignment.status === "PENDING"
    ? `${copy.from} ${assignment.ownerName}`
    : assignment.status === "ACTIVE"
      ? `${copy.relationshipsTitle}: ${assignment.ownerName}`
      : assignment.status === "DECLINED"
        ? `${copy.declined}: ${assignment.ownerName}`
        : assignment.status === "CANCELLED"
          ? `${copy.cancelled}: ${assignment.ownerName}` : `${copy.ended}: ${assignment.ownerName}`;
}

function statusLabel(status: CustodianInboxItem["status"], copy: Dictionary["custodian"]) {
  return status === "PENDING"
    ? copy.invitations
    : status === "ACTIVE"
      ? copy.activeRelationships
      : status === "DECLINED"
        ? copy.declined
        : status === "CANCELLED"
          ? copy.cancelled : copy.ended;
}

function formatDate(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}
