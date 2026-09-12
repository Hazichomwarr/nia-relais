// Each type is imported directly from its own owning testable-core
// module, never from round-lifecycle.actions.ts (a "use server" file) --
// see that file's own comment: re-exporting a type from a Server Action
// module trips the Next.js/Turbopack transform into treating it as a
// callable action reference.
import type { ActivateFirstRoundActionState } from "@/src/actions/activate-first-round";
import type { AdvanceRoundActionState } from "@/src/actions/advance-round";

// Mirrors payout.state.ts's own per-domain initial-action-state
// convention exactly. Deliberately its own file, never merged into
// payout.state.ts/contribution.state.ts (7K.14): round-lifecycle actions
// are a distinct domain from payout recording/confirmation/dispute, even
// though both write to PayoutRound-adjacent state.

export const initialActivateFirstRoundState: ActivateFirstRoundActionState = {};
export const initialAdvanceRoundState: AdvanceRoundActionState = {};
