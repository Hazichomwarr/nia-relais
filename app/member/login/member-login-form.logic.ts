// Framework-free logic extracted out of member-login-form.tsx so it can be
// unit-tested with plain node:test (no DOM, no React renderer) -- see
// member-login-form.test.ts. The component itself only wires these pure
// functions to state, fetch, and navigation.

export type MemberLoginFieldErrors = Partial<
  Record<"circleId" | "memberCode" | "pin", string>
>;

export type MemberLoginFormValues = {
  readonly circleId: string;
  readonly memberCode: string;
  readonly pin: string;
};

// Client-side bounds, deliberately looser than the server's authoritative
// shape check (verifyCircleMemberCredentialsSchema) -- these exist only to
// give a human a helpful "that doesn't look right yet" message before an
// API call, never to decide whether credentials are actually valid. The
// server remains the sole source of truth for that.
const MEMBER_CODE_PATTERN = /^[A-F0-9]{16}$/;
const PIN_PATTERN = /^\d{6}$/;

export const GENERIC_MEMBER_AUTH_ERROR =
  "We couldn't sign you in with that Circle ID, member code, and PIN. Please check them and try again.";

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

  if (values.circleId.trim().length === 0) {
    errors.circleId = "Enter your Circle ID.";
  }

  if (!MEMBER_CODE_PATTERN.test(values.memberCode.trim().toUpperCase())) {
    errors.memberCode = "Enter the 16-character member code exactly as given to you.";
  }

  if (!PIN_PATTERN.test(values.pin.trim())) {
    errors.pin = "Enter your 6-digit PIN.";
  }

  return errors;
}

/**
 * The exact, and only, request body this screen ever sends to
 * POST /api/member/auth/login -- circleId, memberCode, pin, nothing else.
 */
export function buildMemberLoginRequestPayload(values: MemberLoginFormValues): {
  circleId: string;
  memberCode: string;
  pin: string;
} {
  return {
    circleId: values.circleId.trim(),
    memberCode: values.memberCode.trim().toUpperCase(),
    pin: values.pin.trim(),
  };
}

/**
 * Where a successful login navigates to. Takes only the circleId the member
 * themselves typed -- never a member code, PIN, or anything from the login
 * response body (which carries no identity data to begin with).
 */
export function buildMemberCircleHref(circleId: string): string {
  return `/member/circles/${encodeURIComponent(circleId)}`;
}
