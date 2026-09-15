import {
  createDraftCircle,
  createImportedDraftCircle,
  InvalidDraftCircleError,
} from "@/src/services/circle.service";
import { createDraftCircleSchema, createImportedDraftCircleSchema } from "@/src/validations/circle.schema";

// This is the testable core of the "create SUSU circle" Server Action --
// deliberately NOT itself a "use server" file, so it can be imported and
// unit-tested directly with plain node:test (a "use server" file's exports
// must all be action-shaped, which would make dependency injection for
// testing awkward at best). circle.actions.ts is the thin, real "use
// server" wrapper Next.js actually calls; it is not unit-tested directly,
// only structurally (see circle.actions.test.ts), mirroring the
// route.ts/service.ts split used for the member login endpoint (7G.4).

export type CreateDraftCircleActionState = {
  readonly fieldErrors?: Partial<
    Record<
      "name" | "currency" | "contributionAmount" | "frequency" | "startDate"
      | "historicalCompletedRoundCount" | "historicalTermsConfirmed" | "originKind",
      string[]
    >
  >;
  readonly formError?: string;
};

export type CreateDraftCircleOutcome =
  | { readonly ok: true; readonly circleId: string }
  | { readonly ok: false; readonly state: CreateDraftCircleActionState };

export type TrustedOwner = { readonly id: string; readonly name: string };

export type CreateDraftCircleDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly createDraftCircle: typeof createDraftCircle;
  readonly createImportedDraftCircle: typeof createImportedDraftCircle;
};

// requireUser() itself is not imported at the top of this file. Doing so
// would eagerly load next/navigation's redirect() (require-user.ts's own
// dependency), which -- like next/navigation generally -- cannot be
// evaluated outside a real Next.js server runtime (it crashes under the
// plain Node test harness's --conditions=react-server flag, needed for
// "server-only" to resolve as a no-op). Deferring the import into this
// default dependency means it is only ever touched by a real,
// unauthenticated-by-default production call -- every test in
// create-draft-circle.test.ts supplies its own requireUser mock and never
// reaches this function. This dynamic import (unlike a require() of a
// path-aliased specifier) is also exactly what Next's own bundler expects
// and resolves at build time, so production behavior is unaffected.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: CreateDraftCircleDependencies = {
  requireUser: requireRealUser,
  createDraftCircle,
  createImportedDraftCircle,
};

/**
 * Runs the full "create draft circle" flow for one form submission:
 * authenticate the platform User, then branch on the submitted setup-mode
 * choice (`originKind`, 9D.1 §2) to validate either the five NEW-circle
 * fields (unchanged since before 9D.1) or the IMPORTED fields (the same
 * five plus historicalCompletedRoundCount and historicalTermsConfirmed,
 * with no past-date floor on startDate), then call the matching service
 * with an ownerId derived solely from authentication. Never accepts
 * ownerId, status, activatedAt, importedAt, importedById, or any other
 * provenance field from the form.
 *
 * `originKind` itself is read directly from the form (not through either
 * Zod schema) purely to select which validation branch applies -- an
 * invalid/missing value is treated as ordinary invalid input, never
 * defaulted to NEW, so a tampered or missing setup-mode choice cannot
 * silently fall back to different validation than what the visible form
 * offered.
 *
 * requireUser() is called (and, in production, may redirect) BEFORE any
 * validation or service call -- an unauthenticated submission is denied
 * outright, regardless of what the form body contains, rather than first
 * revealing a validation-error shape to an unauthenticated caller. Its
 * exception (a real Next.js redirect, in production) is never caught here
 * -- the try/catch below wraps only the create*DraftCircle call.
 */
export async function runCreateDraftCircleAction(
  formData: FormData,
  dependencies: Partial<CreateDraftCircleDependencies> = {},
): Promise<CreateDraftCircleOutcome> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const originKind = String(formData.get("originKind") ?? "NEW");
  const terms = {
    name: formData.get("name"),
    currency: formData.get("currency"),
    contributionAmount: formData.get("contributionAmount"),
    frequency: formData.get("frequency"),
    startDate: formData.get("startDate"),
  };

  if (originKind === "IMPORTED") {
    const parsed = createImportedDraftCircleSchema.safeParse({
      ...terms,
      historicalCompletedRoundCount: formData.get("historicalCompletedRoundCount"),
      historicalTermsConfirmed: formData.get("historicalTermsConfirmed"),
    });
    if (!parsed.success) {
      return { ok: false, state: { fieldErrors: parsed.error.flatten().fieldErrors } };
    }
    try {
      const circle = await deps.createImportedDraftCircle({ ownerId: user.id, input: parsed.data });
      return { ok: true, circleId: circle.id };
    } catch (error) {
      if (error instanceof InvalidDraftCircleError) {
        return { ok: false, state: { formError: error.message } };
      }
      console.error(
        "[createDraftCircleAction] unexpected failure",
        error instanceof Error ? error.name : "UnknownError",
      );
      return { ok: false, state: { formError: "We could not create your circle. Please try again." } };
    }
  }

  if (originKind !== "NEW") {
    return { ok: false, state: { fieldErrors: { originKind: ["Choose how you are setting up this SUSU."] } } };
  }

  const parsed = createDraftCircleSchema.safeParse(terms);

  if (!parsed.success) {
    return { ok: false, state: { fieldErrors: parsed.error.flatten().fieldErrors } };
  }

  try {
    const circle = await deps.createDraftCircle({ ownerId: user.id, input: parsed.data });
    return { ok: true, circleId: circle.id };
  } catch (error) {
    if (error instanceof InvalidDraftCircleError) {
      return { ok: false, state: { formError: error.message } };
    }

    // Never log submitted form values or secrets -- only the error's own
    // class name, matching every other unexpected-failure log site in this
    // codebase (e.g. createPersonalGoalAction, checkMemberAuthenticationRateLimit).
    console.error(
      "[createDraftCircleAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { ok: false, state: { formError: "We could not create your circle. Please try again." } };
  }
}
