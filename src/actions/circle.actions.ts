"use server";

import { redirect } from "next/navigation";

import {
  runCreateDraftCircleAction,
  type CreateDraftCircleActionState,
} from "@/src/actions/create-draft-circle";

export type { CreateDraftCircleActionState };

/**
 * The real Server Action a future create-circle form (7I.2) will bind to
 * useActionState. All real logic -- authentication, validation, the
 * createDraftCircle call, and error mapping -- lives in
 * runCreateDraftCircleAction (create-draft-circle.ts); this function is
 * intentionally thin so the only thing left to verify here is that it
 * wires that outcome to a real redirect using the circleId the service
 * actually returned.
 */
export async function createDraftCircleAction(
  _previousState: CreateDraftCircleActionState,
  formData: FormData,
): Promise<CreateDraftCircleActionState> {
  const outcome = await runCreateDraftCircleAction(formData);

  if (!outcome.ok) return outcome.state;

  redirect(`/circles/${encodeURIComponent(outcome.circleId)}`);
}
