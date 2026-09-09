import { z } from "zod";

const CUID_PATTERN = /^c[a-z0-9]{24}$/;
const MEMBER_CODE_PATTERN = /^[A-F0-9]{16}$/;
const PIN_PATTERN = /^\d{6}$/;

export const verifyCircleMemberCredentialsSchema = z.object({
  circleId: z.string().regex(CUID_PATTERN),
  memberCode: z.string().trim().toUpperCase().regex(MEMBER_CODE_PATTERN),
  pin: z.string().regex(PIN_PATTERN),
});

export type VerifyCircleMemberCredentialsInput = z.input<typeof verifyCircleMemberCredentialsSchema>;
