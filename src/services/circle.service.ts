import { Prisma, type ContributionFrequency } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

import { computeActivationReviewFingerprint } from "@/src/domain/circle-activation-review";
import { roundDueDate } from "@/src/domain/circle-rotation-schedule";
import { assertRoundLifecycleStateIntegrity, RoundLifecycleStateIntegrityError } from "@/src/domain/round-lifecycle";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  createDraftCircleMember,
  createDraftCircleRecord,
  clearActiveDraftCirclePayoutOrders,
  assignActiveDraftCirclePayoutOrder,
  createCircleActivationObligations,
  createCircleActivationRounds,
  findActiveDraftCircleMembers,
  findCircleActivationObligations,
  findCircleActivationRounds,
  findCircleForActivation,
  findCircleForDraftMembership,
  findDraftCircleMember,
  markCircleActive,
  removeActiveDraftCircleMember,
  type CircleActivationObligationRecord,
  type CircleActivationRecord,
  type CircleActivationRoundRecord,
  type DraftCircleMemberRecord,
  type DraftCirclePayoutMemberRecord,
} from "@/src/repositories/circle.repository";
import { prisma } from "@/src/prisma";
import {
  addDraftCircleMemberSchema,
  createDraftCircleSchema,
  setDraftCirclePayoutOrderSchema,
  type AddDraftCircleMemberInput,
  type CreateDraftCircleInput,
  type SetDraftCirclePayoutOrderInput,
} from "@/src/validations/circle.schema";

export class InvalidDraftCircleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDraftCircleError";
  }
}

export class DraftCircleMemberNotFoundError extends Error {
  constructor() {
    super("Circle member not found.");
    this.name = "DraftCircleMemberNotFoundError";
  }
}

export class DraftCircleMembershipAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to manage this circle.");
    this.name = "DraftCircleMembershipAuthorizationError";
  }
}

export class DraftCircleMembershipConflictError extends Error {
  constructor() {
    super("Circle members can only be changed while the circle is a draft.");
    this.name = "DraftCircleMembershipConflictError";
  }
}

export class DraftCircleMemberCodeGenerationError extends Error {
  constructor() {
    super("A secure member code could not be generated. Please try again.");
    this.name = "DraftCircleMemberCodeGenerationError";
  }
}

export class DraftCirclePayoutOrderError extends Error {
  constructor() {
    super("The payout order must include each active circle member exactly once.");
    this.name = "DraftCirclePayoutOrderError";
  }
}

export class CircleActivationEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircleActivationEligibilityError";
  }
}

export class CircleActivationIntegrityError extends Error {
  constructor() {
    super("The activated circle rotation is incomplete or inconsistent.");
    this.name = "CircleActivationIntegrityError";
  }
}

export class CircleActivationStaleReviewError extends Error {
  constructor() {
    super(
      "This circle's members or payout order changed since it was last reviewed. Please review the current configuration and try again.",
    );
    this.name = "CircleActivationStaleReviewError";
  }
}

export type DraftCircleResult = {
  id: string;
  name: string;
  currency: string;
  contributionAmount: string;
  frequency: ContributionFrequency;
  startDate: string;
  status: "DRAFT";
};

export type DraftCircleMemberResult = {
  id: string;
  circleId: string;
  displayName: string;
  email: string | null;
  memberCode: string;
  payoutOrder: number | null;
  status: "ACTIVE" | "REMOVED";
  addedAt: string;
  removedAt: string | null;
};

export type DraftCirclePayoutOrderMemberResult = {
  id: string;
  circleId: string;
  displayName: string;
  memberCode: string;
  payoutOrder: number;
  status: "ACTIVE";
};

export type CircleActivationResult = {
  circle: { id: string; status: "ACTIVE"; activatedAt: string };
  memberCount: number;
  roundCount: number;
  obligationCount: number;
  rounds: Array<{
    id: string;
    roundNumber: number;
    recipientId: string;
    dueDate: string;
    // Not narrowed to "UPCOMING": a replay of an already-ACTIVE circle
    // (this function's other call site) may observe rounds that have
    // since legitimately progressed via round-lifecycle.service.ts
    // (7K.13) -- this must report each round's true persisted status,
    // never hard-code the fresh-activation value for a replay.
    status: "UPCOMING" | "ACTIVE" | "CLOSED";
  }>;
};

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function generateMemberCode() {
  return randomBytes(8).toString("hex").toUpperCase();
}

function serializeDraftCircleMember(member: DraftCircleMemberRecord): DraftCircleMemberResult {
  return {
    id: member.id,
    circleId: member.circleId,
    displayName: member.displayName,
    email: member.email,
    memberCode: member.memberCode,
    payoutOrder: member.payoutOrder,
    status: member.status,
    addedAt: member.addedAt.toISOString(),
    removedAt: member.removedAt?.toISOString() ?? null,
  };
}

function serializeDraftCirclePayoutMember(
  member: DraftCirclePayoutMemberRecord,
): DraftCirclePayoutOrderMemberResult {
  if (member.payoutOrder === null || member.status !== "ACTIVE") {
    throw new DraftCirclePayoutOrderError();
  }

  return {
    id: member.id,
    circleId: member.circleId,
    displayName: member.displayName,
    memberCode: member.memberCode,
    payoutOrder: member.payoutOrder,
    status: "ACTIVE",
  };
}

function assertDraftOwner(circle: { ownerId: string; status: string }, ownerId: string) {
  if (circle.ownerId !== ownerId) throw new DraftCircleMembershipAuthorizationError();
  if (circle.status !== "DRAFT") throw new DraftCircleMembershipConflictError();
}

/**
 * Closes the race between an owner's activation review (a separate,
 * unlocked read -- see circle-activation-review.service.ts) and this
 * function's own row lock: without this check, membership or payout order
 * could change in the window between the review and lock acquisition, and
 * activateCircle would silently activate that DIFFERENT, never-reviewed
 * configuration. Called only from inside the transaction, after the row
 * lock is held and `members` has been freshly read under that lock -- so
 * the fingerprint compared here is guaranteed current at the instant
 * activation actually proceeds.
 *
 * Reuses computeActivationReviewFingerprint (src/domain/circle-activation-review.ts)
 * unchanged -- the exact same function circle-activation-review.service.ts
 * uses to fingerprint the review the owner actually saw. `members` is
 * sorted by payoutOrder ascending first: for the only cohort shape that
 * ever reaches this call meaningfully -- a complete, valid 1..N order --
 * that sort is unambiguous (no ties) and identical to the review's own
 * ordering; an incomplete order has no well-defined ordering either way,
 * but is already rejected moments later by assertActivationEligible (the
 * DRAFT path) regardless of whether the fingerprint happens to match.
 *
 * expectedFingerprint is optional: omitting it (undefined) skips this
 * check entirely, for any future caller with no review-fingerprint
 * concept.
 */
function assertFreshReviewMatches(
  expectedFingerprint: string | undefined,
  members: DraftCirclePayoutMemberRecord[],
) {
  if (expectedFingerprint === undefined) return;

  const orderedActiveMembers = [...members]
    .sort((left, right) => (left.payoutOrder ?? Number.POSITIVE_INFINITY) - (right.payoutOrder ?? Number.POSITIVE_INFINITY))
    .map((member) => ({
      id: member.id,
      displayName: member.displayName,
      memberCode: member.memberCode,
      payoutOrder: member.payoutOrder,
    }));

  const freshFingerprint = computeActivationReviewFingerprint({ orderedActiveMembers });
  if (freshFingerprint !== expectedFingerprint) {
    throw new CircleActivationStaleReviewError();
  }
}

function assertActivationEligible(
  circle: CircleActivationRecord,
  members: DraftCirclePayoutMemberRecord[],
  rounds: CircleActivationRoundRecord[],
  obligations: CircleActivationObligationRecord[],
) {
  if (members.length < 2) {
    throw new CircleActivationEligibilityError("At least two active members are required to activate a circle.");
  }
  if (rounds.length !== 0 || obligations.length !== 0) {
    throw new CircleActivationEligibilityError("A draft circle cannot contain generated rotation records.");
  }

  const payoutOrders = members.map((member) => member.payoutOrder).sort((left, right) => {
    if (left === null || right === null) return 0;
    return left - right;
  });
  if (payoutOrders.some((order, index) => order !== index + 1)) {
    throw new CircleActivationEligibilityError("Active members must have a complete payout order from 1 through the cohort size.");
  }
}

function serializeActivationResult(
  circle: CircleActivationRecord,
  members: DraftCirclePayoutMemberRecord[],
  rounds: CircleActivationRoundRecord[],
  obligations: CircleActivationObligationRecord[],
): CircleActivationResult {
  if (circle.status !== "ACTIVE" || !circle.activatedAt || !circle.activatedById) {
    throw new CircleActivationIntegrityError();
  }

  return {
    circle: { id: circle.id, status: "ACTIVE", activatedAt: circle.activatedAt.toISOString() },
    memberCount: members.length,
    roundCount: rounds.length,
    obligationCount: obligations.length,
    rounds: rounds
      .sort((left, right) => left.roundNumber - right.roundNumber)
      .map((round) => ({
        id: round.id,
        roundNumber: round.roundNumber,
        recipientId: round.recipientId,
        dueDate: round.dueDate.toISOString(),
        status: round.status,
      })),
  };
}

/**
 * The IMMUTABLE, activation-time shape of a circle's rotation --
 * cohort/round/obligation counts, roundNumber<->payoutOrder<->recipient
 * mapping, due-date recurrence, and each obligation's frozen
 * amount/currency/dueDate. None of these facts ever change once a
 * circle is ACTIVE, with or without round-lifecycle progression (7K.13,
 * evolving the 7K.11 §21.3 finding) -- this is deliberately the half of
 * the original `assertActivatedRotationIntegrity` that stays exactly as
 * strict as before. The one relaxation here versus the pre-7K.13 version:
 * an obligation's `status`/`fulfilledAt` pair is checked only for its own
 * internal coherence (FULFILLED implies a `fulfilledAt`, OPEN implies
 * none), never asserted to be OPEN forever -- contribution confirmation
 * (7J.3) can fulfill any obligation at any time, entirely independently
 * of round lifecycle, so "every obligation is still OPEN" was never a
 * true activation-time invariant to begin with; the mutable, ledger-
 * derived truth of *whether* an obligation is fulfilled is a round-
 * lifecycle CLOSURE question (round-lifecycle.service.ts), not an
 * activation-replay STRUCTURE question.
 */
function assertActivatedRotationStructureIntegrity(
  circle: CircleActivationRecord,
  members: DraftCirclePayoutMemberRecord[],
  rounds: CircleActivationRoundRecord[],
  obligations: CircleActivationObligationRecord[],
) {
  const memberIds = new Set(members.map((member) => member.id));
  if (members.length < 2 || rounds.length !== members.length || obligations.length !== members.length ** 2) {
    throw new CircleActivationIntegrityError();
  }

  const payoutOrders = members.map((member) => member.payoutOrder).sort((left, right) => {
    if (left === null || right === null) return 0;
    return left - right;
  });
  if (payoutOrders.some((order, index) => order !== index + 1)) {
    throw new CircleActivationIntegrityError();
  }

  const recipientIds = new Set(rounds.map((round) => round.recipientId));
  if (recipientIds.size !== members.length || [...recipientIds].some((memberId) => !memberIds.has(memberId))) {
    throw new CircleActivationIntegrityError();
  }

  const membersById = new Map(members.map((member) => [member.id, member]));
  const roundsById = new Map(rounds.map((round) => [round.id, round]));
  const obligationsByRound = new Map<string, CircleActivationObligationRecord[]>();
  for (const obligation of obligations) {
    const round = roundsById.get(obligation.roundId);
    if (!round || obligation.circleId !== circle.id || !memberIds.has(obligation.memberId)) {
      throw new CircleActivationIntegrityError();
    }
    obligationsByRound.set(obligation.roundId, [...(obligationsByRound.get(obligation.roundId) ?? []), obligation]);
  }

  for (const round of rounds) {
    const recipient = membersById.get(round.recipientId);
    const expectedDueDate = roundDueDate(circle, round.roundNumber);
    const roundObligations = obligationsByRound.get(round.id) ?? [];
    const obligatedMembers = new Set(roundObligations.map((obligation) => obligation.memberId));
    if (
      !recipient
      || recipient.payoutOrder !== round.roundNumber
      || round.roundNumber < 1
      || round.dueDate.getTime() !== expectedDueDate.getTime()
      || roundObligations.length !== members.length
      || obligatedMembers.size !== members.length
    ) {
      throw new CircleActivationIntegrityError();
    }

    for (const obligation of roundObligations) {
      const fulfilledCoherent = (obligation.status === "FULFILLED") === (obligation.fulfilledAt !== null);
      if (
        !obligation.expectedAmount.equals(circle.contributionAmount)
        || obligation.currency !== circle.currency
        || obligation.dueDate.getTime() !== round.dueDate.getTime()
        || !fulfilledCoherent
      ) {
        throw new CircleActivationIntegrityError();
      }
    }
  }
}

/**
 * The full activation-replay integrity check `activateCircle` calls at
 * both its own call sites (fresh activation, and replay against an
 * already-ACTIVE circle) -- unchanged in name/signature/external
 * behavior (always throws `CircleActivationIntegrityError`) from before
 * 7K.13, but now composed of two independently-scoped checks (7K.11
 * §21.3's own required evolution): the immutable structure above, plus
 * the MUTABLE round-lifecycle-state shape (`assertRoundLifecycleStateIntegrity`,
 * `src/domain/round-lifecycle.ts`) -- which round-lifecycle.service.ts's
 * own `activateFirstRound`/`advanceRound` also call directly, so the two
 * callers can never silently drift into different definitions of "a
 * coherent round-lifecycle state." A circle whose rounds have legitimately
 * progressed (some CLOSED, at most one ACTIVE, the rest UPCOMING) no
 * longer fails this check merely because progression has begun -- only a
 * genuinely impossible ordering does, exactly as 7K.11 required.
 */
function assertActivatedRotationIntegrity(
  circle: CircleActivationRecord,
  members: DraftCirclePayoutMemberRecord[],
  rounds: CircleActivationRoundRecord[],
  obligations: CircleActivationObligationRecord[],
) {
  assertActivatedRotationStructureIntegrity(circle, members, rounds, obligations);
  try {
    assertRoundLifecycleStateIntegrity(rounds);
  } catch (error) {
    if (error instanceof RoundLifecycleStateIntegrityError) throw new CircleActivationIntegrityError();
    throw error;
  }
}

export async function createDraftCircle(input: {
  ownerId: string;
  input: CreateDraftCircleInput;
}): Promise<DraftCircleResult> {
  if (!input.ownerId) {
    throw new InvalidDraftCircleError("A platform User is required.");
  }

  const parsed = createDraftCircleSchema.safeParse(input.input);
  if (!parsed.success) {
    throw new InvalidDraftCircleError(parsed.error.issues[0]?.message ?? "Circle details are invalid.");
  }

  const circle = await createDraftCircleRecord({
    ownerId: input.ownerId,
    name: parsed.data.name,
    currency: parsed.data.currency,
    contributionAmount: new Prisma.Decimal(parsed.data.contributionAmount),
    frequency: parsed.data.frequency,
    startDate: toUtcDate(parsed.data.startDate),
  });

  return {
    id: circle.id,
    name: circle.name,
    currency: circle.currency,
    contributionAmount: circle.contributionAmount.toFixed(2),
    frequency: circle.frequency,
    startDate: circle.startDate.toISOString().slice(0, 10),
    status: "DRAFT",
  };
}

export async function addDraftCircleMember(input: {
  ownerId: string;
  circleId: string;
  input: AddDraftCircleMemberInput;
}): Promise<DraftCircleMemberResult> {
  if (!input.ownerId || !input.circleId) throw new DraftCircleMemberNotFoundError();

  const parsed = addDraftCircleMemberSchema.safeParse(input.input);
  if (!parsed.success) {
    throw new InvalidDraftCircleError(parsed.error.issues[0]?.message ?? "Member details are invalid.");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const lockedCircle = await lockSavingsCircleForUpdate(transaction, input.circleId);
        if (!lockedCircle) throw new DraftCircleMemberNotFoundError();

        const circle = await findCircleForDraftMembership(transaction, input.circleId);
        if (!circle) throw new DraftCircleMemberNotFoundError();
        assertDraftOwner(circle, input.ownerId);

        const pinHash = await hash(parsed.data.pin, 12);
        const member = await createDraftCircleMember(transaction, {
          circleId: circle.id,
          displayName: parsed.data.displayName,
          email: parsed.data.email,
          memberCode: generateMemberCode(),
          pinHash,
          addedAt: new Date(),
          addedById: input.ownerId,
        });

        return serializeDraftCircleMember(member);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }

  throw new DraftCircleMemberCodeGenerationError();
}

export async function removeDraftCircleMember(input: {
  ownerId: string;
  circleId: string;
  memberId: string;
}): Promise<DraftCircleMemberResult> {
  if (!input.ownerId || !input.circleId || !input.memberId) throw new DraftCircleMemberNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const lockedCircle = await lockSavingsCircleForUpdate(transaction, input.circleId);
    if (!lockedCircle) throw new DraftCircleMemberNotFoundError();

    const circle = await findCircleForDraftMembership(transaction, input.circleId);
    if (!circle) throw new DraftCircleMemberNotFoundError();
    assertDraftOwner(circle, input.ownerId);

    const member = await findDraftCircleMember(transaction, input.circleId, input.memberId);
    if (!member) throw new DraftCircleMemberNotFoundError();
    if (member.status === "REMOVED") return serializeDraftCircleMember(member);

    const updated = await removeActiveDraftCircleMember(transaction, {
      circleId: input.circleId,
      memberId: input.memberId,
      removedAt: new Date(),
      removedById: input.ownerId,
    });

    if (updated.count !== 1) {
      const current = await findDraftCircleMember(transaction, input.circleId, input.memberId);
      if (!current) throw new DraftCircleMemberNotFoundError();
      if (current.status === "REMOVED") return serializeDraftCircleMember(current);
      throw new DraftCircleMembershipConflictError();
    }

    const removed = await findDraftCircleMember(transaction, input.circleId, input.memberId);
    if (!removed) throw new DraftCircleMemberNotFoundError();

    return serializeDraftCircleMember(removed);
  });
}

export async function setDraftCirclePayoutOrder(input: {
  ownerId: string;
  circleId: string;
  orderedMemberIds: SetDraftCirclePayoutOrderInput["orderedMemberIds"];
}): Promise<DraftCirclePayoutOrderMemberResult[]> {
  if (!input.ownerId || !input.circleId) throw new DraftCircleMemberNotFoundError();

  const parsed = setDraftCirclePayoutOrderSchema.safeParse({
    orderedMemberIds: input.orderedMemberIds,
  });
  if (!parsed.success) {
    throw new InvalidDraftCircleError(parsed.error.issues[0]?.message ?? "Payout order is invalid.");
  }

  return prisma.$transaction(async (transaction) => {
    const lockedCircle = await lockSavingsCircleForUpdate(transaction, input.circleId);
    if (!lockedCircle) throw new DraftCircleMemberNotFoundError();

    const circle = await findCircleForDraftMembership(transaction, input.circleId);
    if (!circle) throw new DraftCircleMemberNotFoundError();
    assertDraftOwner(circle, input.ownerId);

    const activeMembers = await findActiveDraftCircleMembers(transaction, circle.id);
    const activeMemberIds = new Set(activeMembers.map((member) => member.id));
    const requestedMemberIds = parsed.data.orderedMemberIds;

    if (
      activeMemberIds.size !== requestedMemberIds.length
      || requestedMemberIds.some((memberId) => !activeMemberIds.has(memberId))
    ) {
      throw new DraftCirclePayoutOrderError();
    }

    const membersById = new Map(activeMembers.map((member) => [member.id, member]));
    const alreadyOrdered = requestedMemberIds.every(
      (memberId, index) => membersById.get(memberId)?.payoutOrder === index + 1,
    );

    if (!alreadyOrdered) {
      await clearActiveDraftCirclePayoutOrders(transaction, circle.id);

      for (const [index, memberId] of requestedMemberIds.entries()) {
        const assigned = await assignActiveDraftCirclePayoutOrder(transaction, {
          circleId: circle.id,
          memberId,
          payoutOrder: index + 1,
        });
        if (assigned.count !== 1) throw new DraftCirclePayoutOrderError();
      }
    }

    const orderedMembers = requestedMemberIds.map((memberId) => membersById.get(memberId));
    if (orderedMembers.some((member) => !member)) throw new DraftCirclePayoutOrderError();

    if (alreadyOrdered) {
      return orderedMembers.map((member) => serializeDraftCirclePayoutMember(member!));
    }

    return orderedMembers.map((member, index) =>
      serializeDraftCirclePayoutMember({ ...member!, payoutOrder: index + 1 }),
    );
  });
}

export async function activateCircle(input: {
  ownerId: string;
  circleId: string;
  /**
   * The fingerprint (computeActivationReviewFingerprint) of the cohort +
   * payout order the caller actually reviewed before confirming
   * activation. When provided, verified atomically against fresh,
   * lock-held state -- see assertFreshReviewMatches -- so a concurrent
   * membership/order change between the caller's review and this
   * function's lock acquisition is rejected rather than silently
   * activating a different configuration than the one confirmed. Omit to
   * skip this check (e.g. a future caller with no review-fingerprint
   * concept); the caller in this codebase (activateCircleAction) always
   * supplies it.
   */
  expectedFingerprint?: string;
}): Promise<CircleActivationResult> {
  if (!input.ownerId || !input.circleId) throw new DraftCircleMemberNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const lockedCircle = await lockSavingsCircleForUpdate(transaction, input.circleId);
    if (!lockedCircle) throw new DraftCircleMemberNotFoundError();

    const circle = await findCircleForActivation(transaction, input.circleId);
    if (!circle) throw new DraftCircleMemberNotFoundError();
    if (circle.ownerId !== input.ownerId) throw new DraftCircleMembershipAuthorizationError();

    const [members, rounds, obligations] = await Promise.all([
      findActiveDraftCircleMembers(transaction, circle.id),
      findCircleActivationRounds(transaction, circle.id),
      findCircleActivationObligations(transaction, circle.id),
    ]);

    if (circle.status === "ACTIVE") {
      assertActivatedRotationIntegrity(circle, members, rounds, obligations);
      // Preserves replay idempotency for a caller reconfirming the same
      // fingerprint it originally activated with (membership/order are
      // frozen post-activation, so a legitimate retry's fingerprint always
      // still matches); a caller whose review no longer matches what is
      // actually persisted is told to review again rather than being
      // handed a success for a configuration it never confirmed. No
      // rounds/obligations are created either way on this branch.
      assertFreshReviewMatches(input.expectedFingerprint, members);
      return serializeActivationResult(circle, members, rounds, obligations);
    }

    if (circle.status !== "DRAFT") {
      throw new CircleActivationEligibilityError("Only draft circles can be activated.");
    }

    assertActivationEligible(circle, members, rounds, obligations);
    // The atomic guard: rejects a stale review BEFORE any round/obligation
    // is created, using the same fresh, lock-held `members` read above --
    // see assertFreshReviewMatches for why this must happen here, inside
    // the transaction, rather than only in the caller's own separate
    // preflight review check.
    assertFreshReviewMatches(input.expectedFingerprint, members);
    const membersByPayoutOrder = [...members].sort((left, right) => left.payoutOrder! - right.payoutOrder!);
    const generatedRounds = await createCircleActivationRounds(transaction, {
      circleId: circle.id,
      rounds: membersByPayoutOrder.map((member) => ({
        roundNumber: member.payoutOrder!,
        recipientId: member.id,
        dueDate: roundDueDate(circle, member.payoutOrder!),
      })),
    });
    const createdObligations = await createCircleActivationObligations(transaction, {
      circleId: circle.id,
      expectedAmount: circle.contributionAmount,
      currency: circle.currency,
      obligations: generatedRounds.flatMap((round) => members.map((member) => ({
        roundId: round.id,
        memberId: member.id,
        dueDate: round.dueDate,
      }))),
    });
    if (createdObligations.count !== members.length ** 2) {
      throw new CircleActivationIntegrityError();
    }

    const activatedAt = new Date();
    const transitioned = await markCircleActive(transaction, {
      circleId: circle.id,
      activatedAt,
      activatedById: input.ownerId,
    });
    if (transitioned.count !== 1) throw new CircleActivationIntegrityError();

    const activatedCircle: CircleActivationRecord = {
      ...circle,
      status: "ACTIVE",
      activatedAt,
      activatedById: input.ownerId,
      completedAt: null,
      completedById: null,
      archivedAt: null,
      archivedById: null,
    };
    const generatedObligations = await findCircleActivationObligations(transaction, circle.id);
    assertActivatedRotationIntegrity(activatedCircle, members, generatedRounds, generatedObligations);

    return serializeActivationResult(
      activatedCircle,
      members,
      generatedRounds,
      generatedObligations,
    );
  });
}
