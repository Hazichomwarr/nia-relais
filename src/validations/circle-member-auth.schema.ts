import { z } from "zod";

// Exported so other server-only modules (the member-auth rate limiter, the
// credential generators in circle.service.ts) can reuse the same shape
// contract instead of redefining it.

// Legacy internal SavingsCircle.id shape. Login accepts this ONLY as a
// bounded, explicit backward-compatibility path (10E §8, option B) for
// credentials issued before circleCode existed -- it is never shown in the
// UI and never generated for anything new. Canonical form is lowercase, as
// persisted.
export const CUID_PATTERN = /^c[a-z0-9]{24}$/;

// Restricted alphabet for every human-facing NIA code (circleCode and, from
// 10E onward, new memberCode values): uppercase letters and digits, minus
// 0/O and 1/I/L -- the six characters most commonly confused with each
// other when read aloud, handwritten, or typed on a handset keypad. 31
// characters remain.
export const HUMAN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// "NIA-" + 4 characters from the restricted alphabet: 31^4 = 923,521
// possible codes. See circle.service.ts's generateCircleCode for the
// collision/namespace analysis; this pattern is the single canonical shape
// contract both generation and login validation are built from. Canonical
// form is uppercase, as persisted.
export const CIRCLE_CODE_PATTERN = /^NIA-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

// A circle login identifier is exactly one of: a new circleCode, or (10E §8
// legacy compatibility) a legacy raw SavingsCircle.id. The two shapes are
// structurally disjoint (a fixed "NIA-" prefix + restricted alphabet vs. a
// lowercase 25-character cuid with no dash), so classification is never
// ambiguous -- there is no input that could plausibly mean either one.
export type CircleLoginIdentifier =
  | { readonly kind: "CIRCLE_CODE"; readonly value: string }
  | { readonly kind: "LEGACY_CIRCLE_ID"; readonly value: string };

/**
 * Classifies and normalizes one raw, untrusted circle login field into
 * exactly one of the two shapes above, or `null` if it matches neither.
 * Case is normalized per-shape (circleCode canonically uppercase,
 * legacy id canonically lowercase, matching how each is actually
 * persisted) -- never blanket-uppercased or -lowercased across both, which
 * would corrupt whichever shape doesn't match that casing.
 *
 * Used by both the credential-verification schema below and the rate
 * limiter's TARGET normalization (circle-member-auth-rate-limit.service.ts),
 * so a request is always classified identically at every stage of the
 * login path.
 */
export function classifyCircleLoginIdentifier(raw: string): CircleLoginIdentifier | null {
  const trimmed = raw.trim();

  const upper = trimmed.toUpperCase();
  if (CIRCLE_CODE_PATTERN.test(upper)) {
    return { kind: "CIRCLE_CODE", value: upper };
  }

  const lower = trimmed.toLowerCase();
  if (CUID_PATTERN.test(lower)) {
    return { kind: "LEGACY_CIRCLE_ID", value: lower };
  }

  return null;
}

// Legacy member codes issued before 10E: 16 uppercase hex characters.
// Preserved exactly -- never invalidated, never backfilled/rewritten.
export const LEGACY_MEMBER_CODE_PATTERN = /^[A-F0-9]{16}$/;

// New member codes (10E onward): 6 characters from the same restricted
// alphabet as circleCode. Uniqueness stays scoped per circle (unchanged
// from the existing @@unique([circleId, memberCode]) contract) -- these two
// generations of code never collide with each other by construction
// (different lengths), so both remain valid login input indefinitely with
// no migration needed.
export const MEMBER_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

// The union every login/verification boundary actually checks incoming
// member codes against.
export const MEMBER_CODE_LOGIN_PATTERN = /^(?:[A-F0-9]{16}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6})$/;

const PIN_PATTERN = /^\d{6}$/;

export const verifyCircleMemberCredentialsSchema = z.object({
  circleCode: z.string().transform((value, ctx) => {
    const identifier = classifyCircleLoginIdentifier(value);
    if (!identifier) {
      ctx.addIssue({ code: "custom", message: "Invalid circle code." });
      return z.NEVER;
    }
    return identifier;
  }),
  memberCode: z.string().trim().toUpperCase().regex(MEMBER_CODE_LOGIN_PATTERN),
  pin: z.string().regex(PIN_PATTERN),
});

export type VerifyCircleMemberCredentialsInput = z.input<typeof verifyCircleMemberCredentialsSchema>;
