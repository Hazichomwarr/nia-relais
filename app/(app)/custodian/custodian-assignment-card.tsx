"use client";

import { useActionState } from "react";

import {
  acceptCustodianAssignmentAction,
  declineCustodianAssignmentAction,
  type CustodianDecisionActionState,
} from "@/src/actions/custodian.actions";
import type { CustodianInboxItem } from "@/src/services/custodian.service";
import type { Dictionary } from "@/src/i18n/dictionaries/types";
import type { Locale } from "@/src/i18n/config";
import { formatMoney } from "@/src/i18n/format";

export function CustodianAssignmentCard({ assignment, dictionary, locale }: { assignment: CustodianInboxItem; dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.custodian;
  const [acceptState, acceptAction, accepting] = useActionState<CustodianDecisionActionState, FormData>(
    acceptCustodianAssignmentAction,
    {},
  );
  const [declineState, declineAction, declining] = useActionState<CustodianDecisionActionState, FormData>(
    declineCustodianAssignmentAction,
    {},
  );
  const decidedStatus = acceptState.assignment?.status ?? declineState.assignment?.status;
  const status = decidedStatus ?? assignment.status;
  const error = acceptState.formError ?? declineState.formError;

  return (
    <article className="rounded-[2rem] border border-[#e4d6c4] bg-[#fffaf0] p-6 shadow-[0_12px_30px_rgba(23,60,53,0.08)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b95035]">{statusLabel(status, copy)}</p>
          <h3 className="mt-2 text-2xl font-semibold">{assignment.goal.name}</h3>
        </div>
        <StatusPill status={status} copy={copy} />
      </div>

      <div className="mt-6 rounded-2xl bg-[#f7eee4] p-5">
        <p className="text-sm text-[#5a6b61]">{copy.from} {assignment.ownerName}</p>
        <p className="mt-1 text-base font-semibold text-[#173c35]">{copy.roleDescription}</p>
      </div>

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-[#7b8179]">{copy.target}</dt><dd className="mt-1 font-semibold">{formatAmount(assignment.goal.targetAmount, assignment.goal.currency)}</dd></div><div><dt className="text-[#7b8179]">{copy.weeklyCommitment}</dt><dd className="mt-1 font-semibold">{formatAmount(assignment.goal.weeklyAmount, assignment.goal.currency)}</dd></div><div><dt className="text-[#7b8179]">{copy.unlockDate}</dt><dd className="mt-1 font-semibold">{formatDate(assignment.goal.unlockDate, locale)}</dd></div>
      </dl>

      {status === "PENDING" ? (
        <>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <form action={acceptAction}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <button type="submit" disabled={accepting || declining} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60">
                {accepting ? copy.accepting : copy.accept}
              </button>
            </form>
            <form action={declineAction}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <button type="submit" disabled={accepting || declining} className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-5 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60">
                {declining ? copy.declining : copy.decline}
              </button>
            </form>
          </div>
          {error ? <p className="mt-3 text-sm text-[#a53f2b]" role="alert">{copy.safeError}</p> : null}
        </>
      ) : status === "ACTIVE" ? (
        <p className="mt-6 rounded-2xl bg-[#e5efe5] p-4 text-sm leading-6 text-[#315b4b]" role="status">{copy.assignmentActive}</p>
      ) : status === "DECLINED" ? (
        <p className="mt-6 rounded-2xl bg-[#f7eee4] p-4 text-sm leading-6 text-[#5a6b61]">{copy.assignmentDeclined}</p>
      ) : status === "CANCELLED" ? (
        <p className="mt-6 rounded-2xl bg-[#f7eee4] p-4 text-sm leading-6 text-[#5a6b61]">{copy.assignmentCancelled}</p>
      ) : (
        <p className="mt-6 rounded-2xl bg-[#f7eee4] p-4 text-sm leading-6 text-[#5a6b61]">{copy.assignmentEnded}</p>
      )}
    </article>
  );
}

function statusLabel(status: CustodianInboxItem["status"], copy: Dictionary["custodian"]) {
  return status === "PENDING"
    ? copy.requestForYou
    : status === "ACTIVE"
      ? copy.activeTrustedPerson
      : status === "DECLINED"
        ? copy.requestDeclined
        : status === "CANCELLED"
          ? copy.requestCancelled : copy.pastAssignment;
}

function StatusPill({ status, copy }: { status: CustodianInboxItem["status"]; copy: Dictionary["custodian"] }) {
  const label = status === "PENDING"
    ? copy.needsAnswer
    : status === "ACTIVE"
      ? copy.active
      : status === "DECLINED"
        ? copy.declined
        : status === "CANCELLED"
          ? copy.cancelled : copy.ended;

  return <span className="rounded-full bg-[#fbe1d1] px-3 py-1 text-xs font-semibold text-[#a53f2b]">{label}</span>;
}

function formatAmount(value: string, currency: string) {
  return formatMoney(value, currency);
}

function formatDate(value: string, locale: Locale) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
}
