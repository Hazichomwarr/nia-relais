import type {
  ConfirmPayoutActionState,
  DisputePayoutActionState,
  RecordPayoutActionState,
} from "@/src/actions/payout.actions";

// Mirrors circle.state.ts / deposit.state.ts's own per-domain
// initial-action-state convention exactly.

export const initialRecordPayoutState: RecordPayoutActionState = {};
export const initialConfirmPayoutState: ConfirmPayoutActionState = {};
export const initialDisputePayoutState: DisputePayoutActionState = {};
