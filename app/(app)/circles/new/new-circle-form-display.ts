import { DRAFT_CIRCLE_FREQUENCIES } from "@/src/validations/circle.schema";

// Pure, framework-free helpers -- no React, no service/repository access.
// Nothing here performs a round-schedule calculation or any date math:
// member count and payout order aren't known yet at circle-creation time
// (see the ticket's explicit instruction not to preview a schedule here),
// so this module only echoes back what the owner already typed.

type Frequency = (typeof DRAFT_CIRCLE_FREQUENCIES)[number];

const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: "every week",
  BIWEEKLY: "every two weeks",
  MONTHLY: "every month",
};

function isKnownFrequency(value: string): value is Frequency {
  return (DRAFT_CIRCLE_FREQUENCIES as readonly string[]).includes(value);
}

export function getFrequencyLabel(frequency: string): string {
  return isKnownFrequency(frequency) ? FREQUENCY_LABELS[frequency] : frequency;
}

const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/**
 * A plain restatement of the contribution terms the owner has typed so
 * far -- e.g. "Each member will contribute USD 25.00 every week." Returns
 * null until all three inputs look complete enough to restate, so the
 * form never shows a half-built or malformed sentence. This is display
 * only: it never computes a due date, a round count, or any other value
 * the server doesn't already know how to compute authoritatively.
 */
export function buildContributionRestatement(input: {
  contributionAmount: string;
  currency: string;
  frequency: string;
}): string | null {
  const amount = input.contributionAmount.trim();
  const currency = input.currency.trim();

  if (!AMOUNT_PATTERN.test(amount) || currency.length === 0) return null;

  return `Each member will contribute ${currency} ${amount} ${getFrequencyLabel(input.frequency)}.`;
}
