import type {
  ActivateCircleActionState,
  AddDraftCircleMemberActionState,
  ConfirmContributionActionState,
  CreateDraftCircleActionState,
  RecordContributionActionState,
  RejectContributionActionState,
  SetDraftCirclePayoutOrderActionState,
} from "@/src/actions/circle.actions";

export const initialCreateDraftCircleState: CreateDraftCircleActionState = {};
export const initialAddDraftCircleMemberState: AddDraftCircleMemberActionState = {};
export const initialSetDraftCirclePayoutOrderState: SetDraftCirclePayoutOrderActionState = {};
export const initialActivateCircleState: ActivateCircleActionState = {};
export const initialRecordContributionState: RecordContributionActionState = {};
export const initialConfirmContributionState: ConfirmContributionActionState = {};
export const initialRejectContributionState: RejectContributionActionState = {};
