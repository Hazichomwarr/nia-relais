import {
  addDraftCircleMember,
  DraftCircleMemberCodeGenerationError,
  DraftCircleMemberNotFoundError,
  DraftCircleMembershipAuthorizationError,
  DraftCircleMembershipConflictError,
  InvalidDraftCircleError,
} from "@/src/services/circle.service";
import { addDraftCircleMemberSchema } from "@/src/validations/circle.schema";

// Testable core, deliberately not a "use server" file -- see
// create-draft-circle.ts's own comment for why (a "use server" file's
// exports must all be action-shaped, which makes DI-style testing
// awkward; circle.actions.ts is the thin real wrapper).

export type AddDraftCircleMemberActionState = {
  readonly status?: "success";
  readonly fieldErrors?: Partial<Record<"displayName" | "email" | "pin", string[]>>;
  readonly formError?: string;
  readonly member?: {
    readonly id: string;
    readonly displayName: string;
    readonly memberCode: string;
  };
};

export type TrustedOwner = { readonly id: string; readonly name: string };

export type AddDraftCircleMemberDependencies = {
  readonly requireUser: () => Promise<TrustedOwner>;
  readonly addDraftCircleMember: typeof addDraftCircleMember;
};

// Deferred for the same reason as create-draft-circle.ts: statically
// importing require-user.ts here would eagerly load next/navigation's
// redirect(), which crashes when evaluated outside a real Next.js server
// runtime (e.g. under the plain Node test harness's --conditions=react-server
// flag). Every test in add-draft-circle-member.test.ts supplies its own
// requireUser mock and never reaches this function.
async function requireRealUser(): Promise<TrustedOwner> {
  const { requireUser } = await import("@/src/auth/require-user");
  return requireUser();
}

const defaultDependencies: AddDraftCircleMemberDependencies = {
  requireUser: requireRealUser,
  addDraftCircleMember,
};

/**
 * Adds one member to a DRAFT circle the caller owns. requireUser() runs
 * first, before any validation -- an unauthenticated submission is denied
 * outright. ownerId comes exclusively from that call; circleId is read
 * from the form (a plain, non-secret id -- the service itself
 * independently re-verifies that this exact circle belongs to this exact
 * owner and is still DRAFT, so a forged circleId from someone else's
 * circle is rejected there, not trusted here). Nothing about ownerId,
 * status, userId, or any other provenance is ever read from the form --
 * only displayName, email, and pin are, and only those three are passed
 * to the service.
 *
 * The service's own DraftCircleMemberResult never contains pinHash or any
 * authentication state (confirmed by reading its type directly -- see the
 * 7I.3 domain audit) -- there is nothing to accidentally leak by returning
 * it. Only the minimal safe identity (id, displayName, memberCode) the
 * ticket asks for is included in the success state; the raw PIN the owner
 * just typed is never round-tripped through this response at all -- the
 * caller (the client form) already has it in its own memory from the
 * moment it was typed, and is expected to combine it with this response's
 * memberCode for the one-time handoff panel itself.
 */
export async function runAddDraftCircleMemberAction(
  formData: FormData,
  dependencies: Partial<AddDraftCircleMemberDependencies> = {},
): Promise<AddDraftCircleMemberActionState> {
  const deps = { ...defaultDependencies, ...dependencies };

  const user = await deps.requireUser();

  const circleId = String(formData.get("circleId") ?? "").trim();
  const parsed = addDraftCircleMemberSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    pin: formData.get("pin"),
  });

  if (circleId.length === 0) {
    return { formError: "We could not find this circle." };
  }
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const member = await deps.addDraftCircleMember({ ownerId: user.id, circleId, input: parsed.data });
    return {
      status: "success",
      member: { id: member.id, displayName: member.displayName, memberCode: member.memberCode },
    };
  } catch (error) {
    // NotFound and Authorization collapse to the same generic message --
    // never reveal whether a circleId belongs to a different owner.
    // Conflict (not DRAFT) is safe to state plainly: assertDraftOwner
    // (circle.service.ts) checks ownership BEFORE draft status, so this
    // error is only ever reachable for a circle the caller genuinely owns.
    if (error instanceof DraftCircleMemberNotFoundError || error instanceof DraftCircleMembershipAuthorizationError) {
      return { formError: "We could not find this circle." };
    }
    if (error instanceof DraftCircleMembershipConflictError) {
      return { formError: "Members can only be added while the circle is still a draft." };
    }
    if (error instanceof InvalidDraftCircleError || error instanceof DraftCircleMemberCodeGenerationError) {
      return { formError: error.message };
    }

    console.error(
      "[addDraftCircleMemberAction] unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return { formError: "We could not add this member. Please try again." };
  }
}
