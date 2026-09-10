import { z } from "zod";

// Input shapes for the future recordPayout / confirmPayout /
// disputePayout services (7K.3+). No service exists yet -- these
// schemas exist so the eventual Server Action wrappers have a
// validated, safely-typed input to hand a service, exactly mirroring
// contribution.schema.ts's own obligationId/paymentId/clientOperationId/
// rejectionReason conventions (the 7K audit found no reason payout
// persistence needs a different identifier or operation-id format).
//
// Deliberately absent from every schema below: circleId (supplied
// separately by the future action/service contract, never duplicated
// here -- see the service call shapes documented at the bottom of this
// file), recipientId, memberId, currency, status, recordedById,
// recordedAt, confirmedByMemberId, confirmedAt, disputedByMemberId,
// disputedAt, round status, and any expected payout amount. Ownership
// and identity come only from requireUser() (owner) or
// requireCircleMember() (recipient) at the future Server Action
// boundary, never from form input; the authoritative expected amount is
// computed fresh, server-side, from the round's own frozen
// ContributionObligation rows (src/domain/payout-accounting.ts's
// computeExpectedPayoutAmount) under the circle-row lock -- never
// trusted from the client. Client-side validation passing is never
// treated as authoritative; the future service re-validates the
// amount's Decimal shape again defensively before use, exactly as
// recordContribution's own parseAmount already does.
//
// Small validation primitives (the id pattern, the money pattern) are
// kept as their own copy here rather than imported from
// contribution.schema.ts -- that file exports no such primitives, and
// this codebase's own established convention (contribution.schema.ts's
// own comment on deposit.schema.ts/custodian-deposit.schema.ts) is a
// small per-domain copy over a cross-domain import for these atoms.

const APPLICATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

const roundId = z
  .string()
  .trim()
  .min(1, "A payout round is required.")
  .max(100, "The round identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The round identifier is invalid.");

const payoutId = z
  .string()
  .trim()
  .min(1, "A payout is required.")
  .max(100, "The payout identifier is invalid.")
  .regex(APPLICATION_ID_PATTERN, "The payout identifier is invalid.");

const money = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, "Use an amount with up to two decimal places.")
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return whole.length <= 16 && !/^0*$/.test(whole + fraction);
  }, "Amount must be greater than zero and fit DECIMAL(18,2).");

const clientOperationId = z
  .string()
  .trim()
  .min(1, "An operation identifier is required.")
  .max(200, "Operation identifier must be 200 characters or fewer.");

const disputeReason = z
  .string()
  .trim()
  .min(1, "Enter a dispute reason.")
  .max(500, "Dispute reason must be 500 characters or fewer.");

export const recordPayoutSchema = z.object({
  roundId,
  amount: money,
  clientOperationId,
});

export const confirmPayoutSchema = z.object({
  payoutId,
});

export const disputePayoutSchema = z.object({
  payoutId,
  disputeReason,
});

export type RecordPayoutInput = z.infer<typeof recordPayoutSchema>;
export type ConfirmPayoutInput = z.infer<typeof confirmPayoutSchema>;
export type DisputePayoutInput = z.infer<typeof disputePayoutSchema>;

// Intended future service call shapes (7K.3+, not implemented by this
// ticket) -- documented here so the schemas above are visibly already
// sized to fit them exactly, with no field left over and none missing:
//
//   recordPayout({ ownerId, circleId, input: RecordPayoutInput })
//   confirmPayout({ circleId, memberId, input: ConfirmPayoutInput })
//   disputePayout({ circleId, memberId, input: DisputePayoutInput })
//
// ownerId always comes from requireUser(); memberId always comes from
// requireCircleMember(circleId) -- both are trusted identity supplied by
// their respective future auth boundary, never form/request authority,
// and neither ever appears as a field inside any *Input type above.
