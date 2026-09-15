import type { Dictionary } from "./dictionaries/types";

// Services and actions remain locale-neutral. This maps only their existing
// safe presentation messages at the owner DRAFT UI boundary.
export function presentSusuDraftError(message: string, copy: Dictionary["susu"]): string {
  const messages: Record<string, string> = {
    "We could not find this circle.": copy.errorNotFound,
    "We could not add this member. Please try again.": copy.errorAddMember,
    "Members can only be added while the circle is still a draft.": copy.errorMemberDraftOnly,
    "Payout order can only be changed while the circle is still a draft.": copy.errorOrderDraftOnly,
    "This order no longer matches the circle's current members. Please review and try again.": copy.errorOrderChanged,
    "We could not save the payout order. Please try again.": copy.errorSaveOrder,
    "Please confirm you have reviewed the members, payout order, and contribution terms before activating.": copy.errorActivationConfirmation,
    "This circle's members or payout order changed since you last reviewed it. Please review the current configuration and try again.": copy.errorActivationStale,
    "This circle is not yet eligible for activation.": copy.errorNotEligible,
    "This circle is no longer a draft.": copy.errorNoLongerDraft,
    "This circle's rotation could not be verified. Please refresh and try again.": copy.errorActivationIntegrity,
    "We could not activate this circle. Please try again.": copy.errorActivate,
    "Importing a SUSU already in progress isn't ready for activation yet. This setup step is coming soon.": copy.errorImportedActivationNotReady,
  };
  return messages[message] ?? message;
}
