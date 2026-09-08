import type { DepositHistoryItem } from "@/src/services/deposit.service";

export function getDepositStatusPresentation(deposit: DepositHistoryItem) {
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

export function formatDepositAmount(value: string, currency: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionPart.padEnd(2, "0");
  const displayedFraction = currency === "XOF" && /^0+$/.test(fraction) ? "" : `.${fraction}`;

  return `${currency} ${groupedWhole}${displayedFraction}`;
}

export function formatDepositDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatDecisionDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
