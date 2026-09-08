"use client";

import { useState } from "react";
import { useActionState } from "react";

import {
  approveCustodianDepositAction,
  rejectCustodianDepositAction,
  type ApproveCustodianDepositActionState,
  type RejectCustodianDepositActionState,
} from "@/src/actions/custodian-deposit.actions";
import type { PendingCustodianDeposit } from "@/src/services/custodian-deposit.service";

export function CustodianPendingDepositCard({ deposit }: { deposit: PendingCustodianDeposit }) {
  const [rejectingOpen, setRejectingOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [approveState, approveAction, approving] = useActionState<ApproveCustodianDepositActionState, FormData>(
    approveCustodianDepositAction,
    {},
  );
  const [rejectState, rejectAction, rejecting] = useActionState<RejectCustodianDepositActionState, FormData>(
    rejectCustodianDepositAction,
    {},
  );

  const decided = approveState.status === "success" || rejectState.status === "success";
  const error = approveState.formError ?? rejectState.formError;
  const reasonError = rejectState.fieldErrors?.rejectionReason?.join(" ");

  return (
    <article className="rounded-[2rem] border border-[#e4d6c4] bg-[#fffaf0] p-6 shadow-[0_12px_30px_rgba(23,60,53,0.08)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b95035]">Awaiting your confirmation</p>
          <h3 className="mt-2 text-2xl font-semibold">{deposit.goal.name}</h3>
          <p className="mt-1 text-sm text-[#5a6b61]">From {deposit.ownerName}</p>
        </div>
        <span className="rounded-full bg-[#fbe1d1] px-3 py-1 text-xs font-semibold text-[#a53f2b]">Pending</span>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-[#f7eee4] p-5">
          <p className="text-sm text-[#7b8179]">Claimed saving</p>
          <p className="mt-1 text-2xl font-semibold text-[#173c35]">{formatAmount(deposit.amount, deposit.goal.currency)}</p>
          <p className="mt-2 text-sm text-[#5a6b61]">On {formatDate(deposit.depositDate)}</p>
        </div>
        <div className="rounded-2xl bg-[#f7eee4] p-5">
          <p className="text-sm text-[#7b8179]">Your role</p>
          <p className="mt-1 text-base font-semibold text-[#173c35]">Confirm whether this saving happened.</p>
          <p className="mt-2 text-sm leading-6 text-[#5a6b61]">NIA does not hold or move the money.</p>
        </div>
      </div>

      {deposit.note ? (
        <div className="mt-4 rounded-2xl border border-[#e4d6c4] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a95f45]">Their note</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#5a6b61]">{deposit.note}</p>
        </div>
      ) : null}

      {deposit.assignment.status === "ENDED" ? (
        <p className="mt-4 text-sm leading-6 text-[#7b8179]">This deposit was recorded while you were the trusted person for this goal.</p>
      ) : null}

      {decided ? (
        <p className="mt-6 rounded-2xl bg-[#e5efe5] p-4 text-sm leading-6 text-[#315b4b]" role="status">
          {approveState.status === "success" ? "Deposit confirmed." : "Deposit not confirmed."}
        </p>
      ) : (
        <div className="mt-7">
          <form action={approveAction}>
            <input type="hidden" name="depositId" value={deposit.id} />
            <button type="submit" disabled={approving || rejecting} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#b96549] px-5 text-sm font-semibold text-white transition hover:bg-[#9f543d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b96549] disabled:cursor-not-allowed disabled:opacity-60">
              {approving ? "Confirming…" : "Approve deposit"}
            </button>
          </form>

          <div className="mt-4">
            {!rejectingOpen ? (
              <button type="button" disabled={approving} onClick={() => setRejectingOpen(true)} className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-5 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#f7eee4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60" aria-expanded="false">
                I can’t confirm this
              </button>
            ) : (
              <form action={rejectAction} className="rounded-2xl border border-[#e4d6c4] bg-[#f7eee4] p-4">
                <input type="hidden" name="depositId" value={deposit.id} />
                <label className="block" htmlFor={`rejection-reason-${deposit.id}`}>
                  <span className="text-sm font-semibold text-[#173c35]">Why can’t you confirm it?</span>
                  <span className="mt-1 block text-xs leading-5 text-[#7b8179]">A short reason helps them understand what needs checking.</span>
                  <textarea
                    id={`rejection-reason-${deposit.id}`}
                    name="rejectionReason"
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    maxLength={500}
                    required
                    rows={4}
                    aria-invalid={Boolean(reasonError)}
                    aria-describedby={`rejection-reason-${deposit.id}-error rejection-reason-${deposit.id}-count`}
                    className="mt-3 w-full rounded-2xl border border-[#c9c5b6] bg-[#fffdf7] px-4 py-3 text-base text-[#173c35] outline-none focus:border-[#b95035] focus:ring-4 focus:ring-[#f2c9af]"
                  />
                </label>
                <div className="mt-1 flex items-start justify-between gap-4 text-xs text-[#7b8179]">
                  <span id={`rejection-reason-${deposit.id}-error`} role="alert" className="text-[#a53f2b]">{reasonError}</span>
                  <span id={`rejection-reason-${deposit.id}-count`} className="ml-auto shrink-0">{rejectionReason.length}/500</span>
                </div>
                {rejectState.formError ? <p className="mt-2 text-sm text-[#a53f2b]" role="alert">{rejectState.formError}</p> : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button type="submit" disabled={approving || rejecting} className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#a95f45] px-4 text-sm font-semibold text-white transition hover:bg-[#8f4e3a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60">
                    {rejecting ? "Rejecting…" : "Reject deposit"}
                  </button>
                  <button type="button" disabled={rejecting} onClick={() => setRejectingOpen(false)} className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#c9c5b6] px-4 text-sm font-semibold text-[#5a6b61] transition hover:bg-[#fffaf0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b95035] disabled:cursor-not-allowed disabled:opacity-60">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
          {error && !rejectingOpen ? <p className="mt-3 text-sm text-[#a53f2b]" role="alert">{error}</p> : null}
        </div>
      )}
    </article>
  );
}

function formatAmount(value: string, currency: string) {
  const [whole, fraction = ""] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction.padEnd(2, "0")}`;
  return `${currency} ${grouped}${displayedFraction}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
}
