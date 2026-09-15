import {
  DraftCircleConfigurationAuthorizationError,
  DraftCircleConfigurationConflictError,
  DraftCircleConfigurationNotFoundError,
  InvalidDraftCircleError,
  updateDraftCircleConfiguration,
} from "@/src/services/circle.service";
import { CIRCLE_ORIGIN_KINDS, updateImportedDraftCircleConfigurationSchema, updateDraftCircleConfigurationSchema } from "@/src/validations/circle.schema";

export type UpdateDraftCircleConfigurationActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<
    Record<
      "name" | "currency" | "contributionAmount" | "frequency" | "startDate"
      | "historicalCompletedRoundCount" | "historicalTermsConfirmed",
      string[]
    >
  >;
  readonly formError?: string;
  readonly circle?: { readonly id: string; readonly name: string };
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type UpdateDraftCircleConfigurationDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly updateDraftCircleConfiguration: typeof updateDraftCircleConfiguration;
};

async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: UpdateDraftCircleConfigurationDependencies = {
  requireUser: requireRealUser,
  updateDraftCircleConfiguration,
};

/**
 * `originKind` is read from a hidden form field that the edit form (9D.0's
 * DraftCircleConfigurationForm, extended by 9D.1) always renders from the
 * circle's own currently-persisted, immutable origin -- it is never a
 * user-editable choice on this form (setup mode is chosen once, only at
 * creation, per 9D.1 §2). It is used here only to select which validation
 * schema applies, exactly like runCreateDraftCircleAction; the service
 * independently re-verifies it against the persisted circle's actual
 * originKind under the row lock and refuses any mismatch (see
 * updateDraftCircleConfiguration's own doc comment), so a tampered hidden
 * field can select the wrong validation branch at worst -- never write the
 * wrong shape or move a circle between origins.
 */
export async function runUpdateDraftCircleConfigurationAction(
  formData: FormData,
  dependencies: Partial<UpdateDraftCircleConfigurationDependencies> = {},
): Promise<UpdateDraftCircleConfigurationActionState> {
  const deps = { ...defaultDependencies, ...dependencies };
  const user = await deps.requireUser();
  const circleId = String(formData.get("circleId") ?? "").trim();
  const originKind = String(formData.get("originKind") ?? "NEW");
  const terms = {
    name: formData.get("name"),
    currency: formData.get("currency"),
    contributionAmount: formData.get("contributionAmount"),
    frequency: formData.get("frequency"),
    startDate: formData.get("startDate"),
  };

  if (circleId.length === 0) return { formError: "We could not find this circle." };
  if (!CIRCLE_ORIGIN_KINDS.includes(originKind as (typeof CIRCLE_ORIGIN_KINDS)[number])) {
    return { formError: "We could not save these circle details. Please try again." };
  }

  const schema = originKind === "IMPORTED" ? updateImportedDraftCircleConfigurationSchema : updateDraftCircleConfigurationSchema;
  const parsed = schema.safeParse(
    originKind === "IMPORTED"
      ? {
          ...terms,
          historicalCompletedRoundCount: formData.get("historicalCompletedRoundCount"),
          historicalTermsConfirmed: formData.get("historicalTermsConfirmed"),
        }
      : terms,
  );

  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  try {
    const circle = await deps.updateDraftCircleConfiguration({
      ownerId: user.id,
      circleId,
      originKind: originKind as (typeof CIRCLE_ORIGIN_KINDS)[number],
      input: parsed.data,
    });
    return { status: "success", circle: { id: circle.id, name: circle.name } };
  } catch (error) {
    if (error instanceof DraftCircleConfigurationNotFoundError || error instanceof DraftCircleConfigurationAuthorizationError) {
      return { formError: "We could not find this circle." };
    }
    if (error instanceof DraftCircleConfigurationConflictError) {
      return { formError: "Circle details can only be changed while this new circle is still a draft." };
    }
    if (error instanceof InvalidDraftCircleError) return { formError: error.message };

    console.error(
      "[updateDraftCircleConfigurationAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not save these circle details. Please try again." };
  }
}
