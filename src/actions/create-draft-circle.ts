import {
  createDraftCircle,
  InvalidDraftCircleError,
} from "@/src/services/circle.service";
import { createDraftCircleSchema } from "@/src/validations/circle.schema";

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
    Record<"name" | "currency" | "contributionAmount" | "frequency" | "startDate", string[]>
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
};

/**
 * Runs the full "create draft circle" flow for one form submission:
 * authenticate the platform User, validate exactly the five creation
 * fields, call the existing createDraftCircle service with an ownerId
 * derived solely from that authentication, and map the outcome to a
 * serializable result. Never accepts ownerId, status, activatedAt, or any
 * other provenance field from the form -- only the five fields below are
 * ever read from it, so there is nothing for a forged extra field to do.
 *
 * requireUser() is called (and, in production, may redirect) BEFORE any
 * validation or service call -- an unauthenticated submission is denied
 * outright, regardless of what the form body contains, rather than first
 * revealing a validation-error shape to an unauthenticated caller. Its
 * exception (a real Next.js redirect, in production) is never caught here
 * -- the try/catch below wraps only the createDraftCircle call.
 */
export async function runCreateDraftCircleAction(
  formData: FormData,
  dependencies: Partial<CreateDraftCircleDependencies> = {},
): Promise<CreateDraftCircleOutcome> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const parsed = createDraftCircleSchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency"),
    contributionAmount: formData.get("contributionAmount"),
    frequency: formData.get("frequency"),
    startDate: formData.get("startDate"),
  });

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
