import type {
  ActivateFirstRoundActionState,
  AdvanceRoundActionState,
} from "@/src/actions/round-lifecycle.actions";

// Mirrors payout.state.ts's own per-domain initial-action-state
// convention exactly. Deliberately its own file, never merged into
// payout.state.ts/contribution.state.ts (7K.14): round-lifecycle actions
// are a distinct domain from payout recording/confirmation/dispute, even
// though both write to PayoutRound-adjacent state.

export const initialActivateFirstRoundState: ActivateFirstRoundActionState = {};
export const initialAdvanceRoundState: AdvanceRoundActionState = {};
