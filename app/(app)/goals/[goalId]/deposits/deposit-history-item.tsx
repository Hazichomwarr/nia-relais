import type { DepositHistoryItem as DepositHistoryItemModel } from "@/src/services/deposit.service";

export default function DepositHistoryItem({
  deposit,
  currency,
}: {
  deposit: DepositHistoryItemModel;
  currency: string;
}) {
  const status = getStatusCopy(deposit);
  const decisionDate = deposit.approvedAt ?? deposit.rejectedAt;

  return (
    <article className="rounded-[1.5rem] border border-[#dfd2c1] bg-[#fffdf8] p-5 shadow-[0_8px_30px_rgba(77,57,40,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xl font-semibold tracking-tight text-[#173b32]">{formatAmount(deposit.amount, currency)}</p>
          <time className="mt-1 block text-sm text-[#7b8179]" dateTime={deposit.depositDate}>
            Recorded on {formatDateOnly(deposit.depositDate)}
          </time>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
          {status.label}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-[#587066]">{status.description}</p>

      {deposit.note ? <p className="mt-3 rounded-xl bg-[#fff4e8] px-4 py-3 text-sm text-[#587066]">{deposit.note}</p> : null}

      {decisionDate ? (
        <time className="mt-4 block text-xs text-[#7b8179]" dateTime={decisionDate}>
          {deposit.status === "APPROVED" ? "Confirmed" : "Reviewed"} {formatDecisionDate(decisionDate)}
        </time>
      ) : null}

      {deposit.status === "REJECTED" && deposit.rejectionReason ? (
        <p className="mt-3 text-sm text-[#7b8179]">Note: {deposit.rejectionReason}</p>
      ) : null}
    </article>
  );
}

function getStatusCopy(deposit: DepositHistoryItemModel) {
  if (deposit.status === "APPROVED") {
    return {
      label: "Confirmed",
      description: "This saving has been confirmed and counts toward your progress.",
      className: "bg-[#e6f0e8] text-[#35634f]",
    };
  }

  if (deposit.status === "PENDING") {
    return {
      label: "Awaiting confirmation",
      description: "This saving was recorded and is waiting for your trusted person to confirm it.",
      className: "bg-[#fff0d9] text-[#8a5b27]",
    };
  }

  return {
    label: "Not confirmed",
    description: "This saving was not confirmed.",
    className: "bg-[#f4e6e1] text-[#8d4f42]",
  };
}

function formatAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDecisionDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
