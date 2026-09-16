import { Prisma, type CircleOriginKind, type ContributionFrequency } from "@prisma/client";

import { prisma } from "@/src/prisma";

export function createDraftCircleRecord(input: {
  ownerId: string;
  circleCode: string;
  name: string;
  currency: string;
  contributionAmount: Prisma.Decimal;
  frequency: ContributionFrequency;
  startDate: Date;
  originKind: CircleOriginKind;
  historicalCompletedRoundCount: number;
}) {
  return prisma.savingsCircle.create({
    data: {
      ownerId: input.ownerId,
      circleCode: input.circleCode,
      name: input.name,
      currency: input.currency,
      contributionAmount: input.contributionAmount,
      frequency: input.frequency,
      startDate: input.startDate,
      status: "DRAFT",
      originKind: input.originKind,
      historicalCompletedRoundCount: input.historicalCompletedRoundCount,
      // Frozen null through DRAFT for both origins (freeze §4): these are
      // set once, together, only by a successfully activated import (9E) --
      // they timestamp/identify NIA receiving the declaration, never the
      // historical events, and never anything a DRAFT create/edit may write.
      importedAt: null,
      importedById: null,
      activatedAt: null,
      activatedById: null,
      completedAt: null,
      completedById: null,
      archivedAt: null,
      archivedById: null,
    },
    select: {
      id: true,
      circleCode: true,
      name: true,
      currency: true,
      contributionAmount: true,
      frequency: true,
      startDate: true,
      status: true,
      originKind: true,
      historicalCompletedRoundCount: true,
    },
  });
}

type CircleTransaction = Prisma.TransactionClient;

const draftCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
} satisfies Prisma.SavingsCircleSelect;

const draftCircleConfigurationSelect = {
  id: true,
  ownerId: true,
  status: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  originKind: true,
  historicalCompletedRoundCount: true,
  importedAt: true,
  importedById: true,
} satisfies Prisma.SavingsCircleSelect;

export type DraftCircleConfigurationRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof draftCircleConfigurationSelect;
}>;

export function findCircleForDraftConfiguration(transaction: CircleTransaction, circleId: string) {
  return transaction.savingsCircle.findUnique({ where: { id: circleId }, select: draftCircleConfigurationSelect });
}

/**
 * Extended by 9D.1 to serve BOTH origins through the one canonical DRAFT
 * editing operation (docs/product/susu-existing-import-contract-freeze.md
 * §3/§9D.0's own foundation) -- never a second, parallel repository writer.
 * `originKind` is never itself part of `data`: origin is "Frozen once
 * created" (freeze §4's own field table) and no writer anywhere may change
 * it. Instead, the `where` clause is a compare-and-swap against the
 * caller's already-verified, persisted `originKind` (circle.service.ts
 * reads it fresh under the same lock before calling this): if the row's
 * actual origin has since diverged from what the caller verified -- never
 * possible today since nothing writes origin post-creation, but this
 * mirrors the same defensive CAS discipline every other SUSU writer in
 * this codebase already applies -- this update affects zero rows rather
 * than silently applying the wrong validation shape.
 */
export function updateDraftCircleConfigurationRecord(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    name: string;
    currency: string;
    contributionAmount: Prisma.Decimal;
    frequency: ContributionFrequency;
    startDate: Date;
    originKind: CircleOriginKind;
    historicalCompletedRoundCount: number;
  },
) {
  return transaction.savingsCircle.updateMany({
    where: { id: input.circleId, status: "DRAFT", originKind: input.originKind },
    data: {
      name: input.name,
      currency: input.currency,
      contributionAmount: input.contributionAmount,
      frequency: input.frequency,
      startDate: input.startDate,
      historicalCompletedRoundCount: input.historicalCompletedRoundCount,
    },
  });
}

const draftMemberSelect = {
  id: true,
  circleId: true,
  displayName: true,
  email: true,
  phone: true,
  memberCode: true,
  payoutOrder: true,
  status: true,
  addedAt: true,
  removedAt: true,
  removedById: true,
} satisfies Prisma.CircleMemberSelect;

export type DraftCircleMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof draftMemberSelect;
}>;

const draftPayoutMemberSelect = {
  id: true,
  circleId: true,
  displayName: true,
  memberCode: true,
  payoutOrder: true,
  status: true,
} satisfies Prisma.CircleMemberSelect;

export type DraftCirclePayoutMemberRecord = Prisma.CircleMemberGetPayload<{
  select: typeof draftPayoutMemberSelect;
}>;

const activationCircleSelect = {
  id: true,
  ownerId: true,
  status: true,
  name: true,
  currency: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  originKind: true,
  historicalCompletedRoundCount: true,
  activatedAt: true,
  activatedById: true,
  importedAt: true,
  importedById: true,
  completedAt: true,
  completedById: true,
  archivedAt: true,
  archivedById: true,
} satisfies Prisma.SavingsCircleSelect;

export type CircleActivationRecord = Prisma.SavingsCircleGetPayload<{
  select: typeof activationCircleSelect;
}>;

const activationRoundSelect = {
  id: true,
  circleId: true,
  roundNumber: true,
  recipientId: true,
  dueDate: true,
  status: true,
  closureBasis: true,
  activatedAt: true,
  activatedById: true,
  closedAt: true,
  closedById: true,
} satisfies Prisma.PayoutRoundSelect;

export type CircleActivationRoundRecord = Prisma.PayoutRoundGetPayload<{
  select: typeof activationRoundSelect;
}>;

const activationObligationSelect = {
  circleId: true,
  roundId: true,
  memberId: true,
  expectedAmount: true,
  currency: true,
  dueDate: true,
  status: true,
  fulfillmentBasis: true,
  fulfilledAt: true,
} satisfies Prisma.ContributionObligationSelect;

export type CircleActivationObligationRecord = Prisma.ContributionObligationGetPayload<{
  select: typeof activationObligationSelect;
}>;

const activationPayoutSelect = {
  id: true,
  circleId: true,
  roundId: true,
  amount: true,
  currency: true,
  status: true,
  confirmationBasis: true,
  clientOperationId: true,
  recordedAt: true,
  recordedById: true,
  confirmedAt: true,
  confirmedByMemberId: true,
  disputedAt: true,
  disputedByMemberId: true,
  disputeReason: true,
} satisfies Prisma.PayoutSelect;

export type CircleActivationPayoutRecord = Prisma.PayoutGetPayload<{
  select: typeof activationPayoutSelect;
}>;

export function findCircleForDraftMembership(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.savingsCircle.findUnique({
    where: { id: circleId },
    select: draftCircleSelect,
  });
}

export function createDraftCircleMember(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    displayName: string;
    email: string | undefined;
    phone: string | undefined;
    memberCode: string;
    pinHash: string;
    addedAt: Date;
    addedById: string;
  },
) {
  return transaction.circleMember.create({
    data: {
      circleId: input.circleId,
      userId: null,
      displayName: input.displayName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      memberCode: input.memberCode,
      pinHash: input.pinHash,
      payoutOrder: null,
      status: "ACTIVE",
      addedAt: input.addedAt,
      addedById: input.addedById,
      removedAt: null,
      removedById: null,
    },
    select: draftMemberSelect,
  });
}

export function findDraftCircleMember(
  transaction: CircleTransaction,
  circleId: string,
  memberId: string,
) {
  return transaction.circleMember.findFirst({
    where: { id: memberId, circleId },
    select: draftMemberSelect,
  });
}

export function removeActiveDraftCircleMember(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    memberId: string;
    removedAt: Date;
    removedById: string;
  },
) {
  return transaction.circleMember.updateMany({
    where: { id: input.memberId, circleId: input.circleId, status: "ACTIVE" },
    data: {
      status: "REMOVED",
      payoutOrder: null,
      removedAt: input.removedAt,
      removedById: input.removedById,
    },
  });
}

export function findActiveDraftCircleMembers(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.circleMember.findMany({
    where: { circleId, status: "ACTIVE" },
    select: draftPayoutMemberSelect,
  });
}

export function clearActiveDraftCirclePayoutOrders(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.circleMember.updateMany({
    where: { circleId, status: "ACTIVE" },
    data: { payoutOrder: null },
  });
}

export function assignActiveDraftCirclePayoutOrder(
  transaction: CircleTransaction,
  input: { circleId: string; memberId: string; payoutOrder: number },
) {
  return transaction.circleMember.updateMany({
    where: { id: input.memberId, circleId: input.circleId, status: "ACTIVE" },
    data: { payoutOrder: input.payoutOrder },
  });
}

export function findCircleForActivation(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.savingsCircle.findUnique({
    where: { id: circleId },
    select: activationCircleSelect,
  });
}

export function findCircleActivationRounds(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.payoutRound.findMany({
    where: { circleId },
    select: activationRoundSelect,
  });
}

export function findCircleActivationObligations(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.contributionObligation.findMany({
    where: { circleId },
    select: activationObligationSelect,
  });
}

/**
 * Every Payout row belonging to this circle's rotation -- empty for a
 * normal (NEW-origin) activation, since normal activation never creates
 * Payout rows at all (only recordPayout, entirely separate, does, later).
 * Exists solely so imported-activation's own integrity self-check (9E,
 * circle.service.ts's assertImportedReconstructionIntegrity) can verify
 * every historical round's one IMPORTED_DECLARATION payout without a
 * second, independent Payout query shape.
 */
export function findCircleActivationPayouts(
  transaction: CircleTransaction,
  circleId: string,
) {
  return transaction.payout.findMany({
    where: { circleId },
    select: activationPayoutSelect,
  });
}

/**
 * Creates the full N-round rotation, reused unchanged by both normal
 * (NEW-origin) and imported activation (circle.service.ts's
 * activateCircle/activateImportedCircle) -- there is exactly one round
 * generator in this codebase.
 *
 * `closedImport`, present only for a historical round in an imported
 * circle's 1..K prefix (9E), is the ONLY thing that varies: it produces a
 * round created directly in its final CLOSED/IMPORTED_DECLARATION shape,
 * with the owner's import-declaration actor/time standing in for both
 * activation and closure provenance (per the freeze's own "use the import
 * declaration actor/time only" rule -- src/services/circle.service.ts has
 * the full reasoning). Omitting it (every normal-activation call site, and
 * every K+1..N round of an imported circle) produces the exact same
 * UPCOMING/NIA_MANAGED row this function has always created.
 */
export function createCircleActivationRounds(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    rounds: Array<{
      roundNumber: number;
      recipientId: string;
      dueDate: Date;
      closedImport?: { at: Date; byId: string };
    }>;
  },
) {
  return Promise.all(input.rounds.map((round) => transaction.payoutRound.create({
    data: {
      circleId: input.circleId,
      roundNumber: round.roundNumber,
      recipientId: round.recipientId,
      dueDate: round.dueDate,
      status: round.closedImport ? "CLOSED" : "UPCOMING",
      closureBasis: round.closedImport ? "IMPORTED_DECLARATION" : "NIA_MANAGED",
      activatedAt: round.closedImport?.at ?? null,
      activatedById: round.closedImport?.byId ?? null,
      closedAt: round.closedImport?.at ?? null,
      closedById: round.closedImport?.byId ?? null,
    },
    select: activationRoundSelect,
  })));
}

/**
 * Creates the full N² obligation set, reused unchanged by both normal and
 * imported activation -- see createCircleActivationRounds's own comment;
 * the identical additive-optional-field shape applies here.
 * `fulfilledImport`, present only for an obligation belonging to a
 * historical round, produces it directly FULFILLED/IMPORTED_DECLARATION
 * with no backing ContributionPayment row -- never fabricated, per the
 * freeze's own explicit prohibition (§4: "no ContributionPayment rows or a
 * recipient confirmation").
 */
export function createCircleActivationObligations(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    expectedAmount: Prisma.Decimal;
    currency: string;
    obligations: Array<{
      roundId: string;
      memberId: string;
      dueDate: Date;
      fulfilledImport?: { at: Date };
    }>;
  },
) {
  return transaction.contributionObligation.createMany({
    data: input.obligations.map((obligation) => ({
      circleId: input.circleId,
      roundId: obligation.roundId,
      memberId: obligation.memberId,
      expectedAmount: input.expectedAmount,
      currency: input.currency,
      dueDate: obligation.dueDate,
      status: obligation.fulfilledImport ? "FULFILLED" : "OPEN",
      fulfillmentBasis: obligation.fulfilledImport ? "IMPORTED_DECLARATION" : "NIA_CONFIRMED_LEDGER",
      fulfilledAt: obligation.fulfilledImport?.at ?? null,
    })),
  });
}

/**
 * The one historical Payout row per imported round (9E only -- normal
 * activation never calls this; recordPayout, entirely separate, is the
 * only writer for a NIA-managed round's payout, and only much later).
 * `clientOperationId` is deterministic (`imported-activation:<roundId>`),
 * never client-supplied -- there is exactly one legitimate payout per
 * historical round, created exactly once, inside the same activation
 * transaction that creates the round itself, so no replay/idempotency
 * concern distinct from the round/obligation creation above exists.
 *
 * `confirmedByMemberId` is always null -- never fabricates a recipient's
 * own confirmation action (freeze §4's own required interpretation).
 * `recordedAt`/`confirmedAt` are both the single shared import-declaration
 * timestamp, never a claimed real-world payout or confirmation time.
 */
export function createImportedRoundPayouts(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    recordedById: string;
    importedAt: Date;
    amount: Prisma.Decimal;
    currency: string;
    rounds: Array<{ roundId: string }>;
  },
) {
  return Promise.all(input.rounds.map((round) => transaction.payout.create({
    data: {
      circleId: input.circleId,
      roundId: round.roundId,
      amount: input.amount,
      currency: input.currency,
      status: "CONFIRMED",
      confirmationBasis: "IMPORTED_DECLARATION",
      clientOperationId: `imported-activation:${round.roundId}`,
      recordedAt: input.importedAt,
      recordedById: input.recordedById,
      confirmedAt: input.importedAt,
      confirmedByMemberId: null,
      disputedAt: null,
      disputedByMemberId: null,
      disputeReason: null,
    },
    select: activationPayoutSelect,
  })));
}

/**
 * The sole writer of `status -> ACTIVE` (unchanged count: still exactly
 * one), extended by 9E to optionally also set the frozen import-provenance
 * pair in the SAME write. `importedAt`/`importedById` are only included in
 * `data` when BOTH are supplied together (imported activation always
 * supplies both; normal activation supplies neither) -- omitting them
 * entirely from `data` for a normal activation leaves the column exactly
 * as DRAFT creation already left it (null), never writes null again
 * redundantly, and never risks a normal activation accidentally clearing a
 * value that was never there to begin with.
 */
export function markCircleActive(
  transaction: CircleTransaction,
  input: {
    circleId: string;
    activatedAt: Date;
    activatedById: string;
    importedAt?: Date;
    importedById?: string;
  },
) {
  return transaction.savingsCircle.updateMany({
    where: { id: input.circleId, status: "DRAFT" },
    data: {
      status: "ACTIVE",
      activatedAt: input.activatedAt,
      activatedById: input.activatedById,
      completedAt: null,
      completedById: null,
      archivedAt: null,
      archivedById: null,
      ...(input.importedAt !== undefined && input.importedById !== undefined
        ? { importedAt: input.importedAt, importedById: input.importedById }
        : {}),
    },
  });
}
