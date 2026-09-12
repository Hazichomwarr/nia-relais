// Each type is imported directly from its own owning testable-core
// module, never from payout.actions.ts (a "use server" file) -- see that
// file's own comment: re-exporting a type from a Server Action module
// trips the Next.js/Turbopack transform into treating it as a callable
// action reference.
import type { ConfirmPayoutActionState } from "@/src/actions/confirm-payout";
import type { DisputePayoutActionState } from "@/src/actions/dispute-payout";
import type { RecordPayoutActionState } from "@/src/actions/record-payout";

// Mirrors circle.state.ts / deposit.state.ts's own per-domain
// initial-action-state convention exactly.

export const initialRecordPayoutState: RecordPayoutActionState = {};
export const initialConfirmPayoutState: ConfirmPayoutActionState = {};
export const initialDisputePayoutState: DisputePayoutActionState = {};
