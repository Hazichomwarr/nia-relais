import { cookies } from "next/headers";

import {
  CIRCLE_MEMBER_SESSION_COOKIE_NAME,
  CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS,
} from "@/src/auth/circle-member-session-cookie";
import { loginCircleMember } from "@/src/services/circle-member-login.service";

// Route namespace decision (7G.4, Section 2): this endpoint lives at
// /api/member/auth/login, under the future page namespace's sibling
// /member/... (e.g. /member/login, /member/circles/[circleId] -- not built
// in this ticket). See CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS for why the
// cookie's Path is "/" rather than a narrower shared prefix.

// One generic public response for every authentication-relevant failure --
// unknown circle, unknown member code, wrong PIN, removed member, DRAFT
// circle, locked member, or rate limit exceeded are all indistinguishable
// from the outside. Only a 500 (this handler's own unexpected crash, not an
// authentication outcome) differs, and even then the body carries no detail.
const GENERIC_FAILURE_BODY = { ok: false as const, error: "Invalid credentials." };

export async function POST(request: Request): Promise<Response> {
  const result = await loginCircleMember(request);

  if (!result.ok) {
    return Response.json(GENERIC_FAILURE_BODY, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(
    CIRCLE_MEMBER_SESSION_COOKIE_NAME,
    result.rawToken,
    CIRCLE_MEMBER_SESSION_COOKIE_OPTIONS,
  );

  // The raw token lives only in the Set-Cookie header written above -- the
  // JSON body below never carries it.
  return Response.json({ ok: true });
}
