// Each type is imported directly from its own owning testable-core
// module, never from circle.actions.ts (a "use server" file) -- see that
// file's own comment: re-exporting a type from a Server Action module
// trips the Next.js/Turbopack transform into treating it as a callable
// action reference.
import type { ActivateCircleActionState } from "@/src/actions/activate-circle";
import type { AddDraftCircleMemberActionState } from "@/src/actions/add-draft-circle-member";
import type { ConfirmContributionActionState } from "@/src/actions/confirm-contribution";
import type { CreateDraftCircleActionState } from "@/src/actions/create-draft-circle";
import type { RecordContributionActionState } from "@/src/actions/record-contribution";
import type { RejectContributionActionState } from "@/src/actions/reject-contribution";
import type { SetDraftCirclePayoutOrderActionState } from "@/src/actions/set-draft-circle-payout-order";

export const initialCreateDraftCircleState: CreateDraftCircleActionState = {};
export const initialAddDraftCircleMemberState: AddDraftCircleMemberActionState = {};
export const initialSetDraftCirclePayoutOrderState: SetDraftCirclePayoutOrderActionState = {};
export const initialActivateCircleState: ActivateCircleActionState = {};
export const initialRecordContributionState: RecordContributionActionState = {};
export const initialConfirmContributionState: ConfirmContributionActionState = {};
export const initialRejectContributionState: RejectContributionActionState = {};
