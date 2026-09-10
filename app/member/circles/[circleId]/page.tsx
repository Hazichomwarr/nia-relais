import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireCircleMember } from "@/src/auth/require-circle-member";
import {
  CircleMemberDashboardCircleNotEligibleError,
  CircleMemberDashboardCircleNotFoundError,
  CircleMemberDashboardMemberNotActiveError,
  CircleMemberDashboardMemberNotFoundError,
  getCircleMemberDashboard,
} from "@/src/services/circle-member-dashboard.service";
import {
  getCircleMemberPayouts,
  MemberPayoutsCircleNotEligibleError,
  MemberPayoutsCircleNotFoundError,
  MemberPayoutsMemberNotActiveError,
  MemberPayoutsMemberNotFoundError,
} from "@/src/services/payout-member-read.service";

import { MemberDashboard } from "./member-dashboard";
import { MemberPayoutCard } from "./member-payout-card";

export const metadata: Metadata = {
  title: "Your circle · NIA",
};

// The read-only SUSU member dashboard (7H.3), replacing the 7G.5
// placeholder. Authorization and data access are two separate, already-
// built primitives this page only wires together:
//   requireCircleMember (7H.1) -- derives memberId from the validated
//     session only; never accepts one from the URL, a query param, or any
//     client-suppliable value.
//   getCircleMemberDashboard (7H.2) -- accepts that trusted identity and
//     returns an already-serialized, already-scoped read model.
// This page performs no data fetching logic, no accounting, and no
// financial mutation of its own.
export default async function MemberCirclePage({
  params,
}: {
  params: Promise<{ circleId: string }>;
}) {
  const { circleId } = await params;

  // requireCircleMember redirects to /member/login on any failure -- no
  // session, expired/revoked, removed member, ineligible circle, or a
  // cross-circle mismatch -- so nothing below this line runs unless the
  // request is genuinely authorized for this exact circle. identity.memberId
  // comes only from the validated session, never from `circleId` or any
  // other request-supplied value.
  const identity = await requireCircleMember(circleId);

  let dashboard;
  let payouts;
  try {
    // Fetched in parallel: two independent, lock-free reads scoped by the
    // SAME trusted identity -- getCircleMemberPayouts (7K.8) is never
    // queried via a new API route, never fetched client-side, and never
    // widened to a full-circle ledger; its own DB-level
    // circleId+recipientId filter is the sole reason this page can never
    // render another member's payout.
    [dashboard, payouts] = await Promise.all([
      getCircleMemberDashboard(identity),
      getCircleMemberPayouts(identity),
    ]);
  } catch (error) {
    // These are internal relational-integrity errors (see 7H.2/7K.8) that
    // should be unreachable here in practice, since requireCircleMember
    // already re-validated membership/circle eligibility moments ago --
    // they exist as defense in depth, not as an expected path. Treat them
    // exactly like any other member-namespace authorization failure:
    // redirect to /member/login without exposing which check failed or
    // whether the circle exists. A genuinely unexpected error (e.g. a
    // database outage, or a genuine persisted-payout integrity conflict)
    // is not one of these classes and is left to propagate to Next's own
    // error boundary rather than silently hidden.
    if (
      error instanceof CircleMemberDashboardCircleNotFoundError
      || error instanceof CircleMemberDashboardCircleNotEligibleError
      || error instanceof CircleMemberDashboardMemberNotFoundError
      || error instanceof CircleMemberDashboardMemberNotActiveError
      || error instanceof MemberPayoutsCircleNotFoundError
      || error instanceof MemberPayoutsCircleNotEligibleError
      || error instanceof MemberPayoutsMemberNotFoundError
      || error instanceof MemberPayoutsMemberNotActiveError
    ) {
      redirect("/member/login");
    }
    throw error;
  }

  return (
    <MemberDashboard dashboard={dashboard}>
      <MemberPayoutCard circleId={circleId} payouts={payouts} />
    </MemberDashboard>
  );
}
