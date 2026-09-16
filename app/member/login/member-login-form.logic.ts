// Framework-free logic extracted out of member-login-form.tsx so it can be
// unit-tested with plain node:test (no DOM, no React renderer) -- see
// member-login-form.test.ts. The component itself only wires these pure
// functions to state, fetch, and navigation.

export type MemberLoginFieldErrors = Partial<
  Record<"circleCode" | "memberCode" | "pin", string>
>;

export type MemberLoginFormValues = {
  readonly circleCode: string;
  readonly memberCode: string;
  readonly pin: string;
};

// Client-side bounds, deliberately looser than the server's authoritative
// shape check (verifyCircleMemberCredentialsSchema) -- these exist only to
// give a human a helpful "that doesn't look right yet" message before an
// API call, never to decide whether credentials are actually valid. The
// server remains the sole source of truth for that. circleCode is checked
// only for non-emptiness here (not the "NIA-XXXX" shape): a member with a
// credential issued before 10E may still legitimately type their old raw
// circle id into this same field, and the server's own classification
// (classifyCircleLoginIdentifier) is what actually decides which shape it
// is -- this field must not reject that up front. memberCode accepts
// either the new 6-character code or a legacy 16-character hex code, for
// the same reason.
const MEMBER_CODE_PATTERN = /^(?:[A-F0-9]{16}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6})$/;
const PIN_PATTERN = /^\d{6}$/;

export const GENERIC_MEMBER_AUTH_ERROR =
  "We couldn't sign you in with that Circle Code, member code, and PIN. Please check them and try again.";

export const MEMBER_AUTH_NETWORK_ERROR =
  "We couldn't reach NIA right now. Please check your connection and try again.";

/**
 * Format-only validation. Never distinguishes "this circle doesn't exist"
 * from "this looks malformed" -- that distinction belongs solely to the
 * server, and this function has no way to make it anyway (it never talks to
 * the network).
 */
export function validateMemberLoginForm(
  values: MemberLoginFormValues,
): MemberLoginFieldErrors {
  const errors: MemberLoginFieldErrors = {};

  if (values.circleCode.trim().length === 0) {
    errors.circleCode = "Enter your Circle Code.";
  }

  if (!MEMBER_CODE_PATTERN.test(values.memberCode.trim().toUpperCase())) {
    errors.memberCode = "Enter the member code exactly as given to you.";
  }

  if (!PIN_PATTERN.test(values.pin.trim())) {
    errors.pin = "Enter your 6-digit PIN.";
  }

  return errors;
}

/**
 * The exact, and only, request body this screen ever sends to
 * POST /api/member/auth/login -- circleCode, memberCode, pin, nothing else.
 * circleCode is sent trimmed but NOT case-normalized here: unlike
 * memberCode, its canonical casing depends on which shape it turns out to
 * be (a new circleCode is canonically uppercase, a legacy raw circle id is
 * canonically lowercase), and only the server's classification
 * (classifyCircleLoginIdentifier) can tell those apart -- so this function
 * deliberately leaves that decision to the server rather than guessing.
 */
export function buildMemberLoginRequestPayload(values: MemberLoginFormValues): {
  circleCode: string;
  memberCode: string;
  pin: string;
} {
  return {
    circleCode: values.circleCode.trim(),
    memberCode: values.memberCode.trim().toUpperCase(),
    pin: values.pin.trim(),
  };
}

/**
 * Where a successful login navigates to. Takes only the internal circleId
 * the server's own login response returned -- never a member code, PIN, or
 * the raw circleCode/legacy-id the member typed (the server-resolved id is
 * the only value this function is ever given).
 */
export function buildMemberCircleHref(circleId: string): string {
  return `/member/circles/${encodeURIComponent(circleId)}`;
}
