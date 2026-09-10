import type { RecordPayoutActionState } from "@/src/actions/payout.actions";

// Mirrors circle.state.ts / deposit.state.ts's own per-domain
// initial-action-state convention exactly. Only the owner's
// record-payout form exists yet (7K.9) -- confirmPayoutAction/
// disputePayoutAction have no UI to initialize a state for until the
// recipient confirm/dispute UI (7K.10) is built.

export const initialRecordPayoutState: RecordPayoutActionState = {};
