import { Prisma, type ContributionFrequency } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

import { computeActivationReviewFingerprint } from "@/src/domain/circle-activation-review";
import { roundDueDate } from "@/src/domain/circle-rotation-schedule";
import { computeExpectedPayoutAmount } from "@/src/domain/payout-accounting";
import { GeneratedCodeExhaustedError, withGeneratedCodeRetry } from "@/src/domain/generated-code-retry";
import { assertRoundLifecycleStateIntegrity, RoundLifecycleStateIntegrityError } from "@/src/domain/round-lifecycle";
import { lockSavingsCircleForUpdate } from "@/src/repositories/circle-lock.repository";
import {
  createDraftCircleMember,
  createDraftCircleRecord,
  createImportedRoundPayouts,
  clearActiveDraftCirclePayoutOrders,
  assignActiveDraftCirclePayoutOrder,
  createCircleActivationObligations,
  createCircleActivationRounds,
  findActiveDraftCircleMembers,
  findCircleActivationObligations,
  findCircleActivationPayouts,
  findCircleActivationRounds,
  findCircleForActivation,
  findCircleForDraftConfiguration,
  findCircleForDraftMembership,
  findDraftCircleMember,
  markCircleActive,
  removeActiveDraftCircleMember,
  updateDraftCircleConfigurationRecord,
  type CircleActivationObligationRecord,
  type CircleActivationPayoutRecord,
  type CircleActivationRecord,
  type CircleActivationRoundRecord,
  type DraftCircleMemberRecord,
  type DraftCirclePayoutMemberRecord,
} from "@/src/repositories/circle.repository";
import { prisma } from "@/src/prisma";
import {
  addDraftCircleMemberSchema,
  CIRCLE_ORIGIN_KINDS,
  createDraftCircleSchema,
  createImportedDraftCircleSchema,
  setDraftCirclePayoutOrderSchema,
  updateDraftCircleConfigurationSchema,
  updateImportedDraftCircleConfigurationSchema,
  type AddDraftCircleMemberInput,
  type CreateDraftCircleInput,
  type CreateImportedDraftCircleInput,
  type SetDraftCirclePayoutOrderInput,
  type UpdateImportedDraftCircleConfigurationInput,
} from "@/src/validations/circle.schema";
import { HUMAN_CODE_ALPHABET } from "@/src/validations/circle-member-auth.schema";

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

export class DraftCircleCodeGenerationError extends Error {
  constructor() {
    super("A secure circle code could not be generated. Please try again.");
    this.name = "DraftCircleCodeGenerationError";
  }
}

export class DraftCirclePayoutOrderError extends Error {
  constructor() {
    super("The payout order must include each active circle member exactly once.");
    this.name = "DraftCirclePayoutOrderError";
  }
}

export class DraftCircleConfigurationNotFoundError extends Error {
  constructor() {
    super("Circle not found.");
    this.name = "DraftCircleConfigurationNotFoundError";
  }
}

export class DraftCircleConfigurationAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to edit this circle.");
    this.name = "DraftCircleConfigurationAuthorizationError";
  }
}

export class DraftCircleConfigurationConflictError extends Error {
  constructor() {
    super("Circle details can only be changed while this new circle is still a draft.");
    this.name = "DraftCircleConfigurationConflictError";
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

// 9D.1 (docs/product/susu-existing-import-contract-freeze.md §5/§10): the
// narrowest possible guard at the one authoritative activation boundary.
// Until 9E implements the locked, transactional historical-reconstruction
// algorithm, an IMPORTED DRAFT must never be allowed to flow through
// activateCircle's normal (NEW-only) path -- that path creates every round
// UPCOMING/every obligation OPEN unconditionally, which for an IMPORTED
// circle would silently discard its declared pre-NIA history rather than
// reconstruct it. This message is intentionally exact-string-matched by
// src/i18n/susu-draft-error-presentation.ts for localized presentation.
export const IMPORTED_ACTIVATION_NOT_READY_MESSAGE =
  "Importing a SUSU already in progress isn't ready for activation yet. This setup step is coming soon.";

export type DraftCircleResult = {
  id: string;
  circleCode: string;
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
  phone: string | null;
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

// Shared collision predicate for every server-side human-code generation
// site below (SavingsCircle.circleCode, CircleMember.memberCode): a P2002
// violation is the database UNIQUE constraint -- the sole authoritative
// concurrency-safe guarantee (10E CODE GENERATION AUTHORITY) -- rejecting
// this specific candidate, never a sign generation itself is broken.
function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// 10E: both human-facing codes draw from the same restricted alphabet
// (HUMAN_CODE_ALPHABET -- uppercase letters and digits, minus 0/O and
// 1/I/L) exported by the credential-validation schema, so generation and
// login validation can never drift out of sync with each other.
function generateHumanCode(length: number): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += HUMAN_CODE_ALPHABET[bytes[index] % HUMAN_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * "NIA-" + 4 characters from the restricted 31-character alphabet:
 * 31^4 = 923,521 possible codes. At NIA's realistic circle-creation scale
 * (savings circles are created one at a time by human organizers, not in
 * bulk -- hundreds to low thousands over the product's lifetime is a
 * generous ceiling, not a floor), a pure 4-DIGIT numeric namespace
 * (10,000 values) would already reach a ~50% chance of at least one
 * collision by roughly its 120th circle (birthday-paradox approximation
 * 1.18*sqrt(N)) -- survivable only because collisions are always retried
 * against the database UNIQUE constraint below, never assumed safe, but
 * still an avoidable cost. This 31-character alphanumeric alphabet pushes
 * that same 50%-collision point out to roughly the 1,100th circle while
 * keeping the human-facing code exactly as short (4 characters) as the
 * ticket's own "NIA-7K42" / "NIA-K7M4" examples -- the smallest namespace
 * that stays comfortably ahead of realistic scale without lengthening the
 * code. Never derived from SavingsCircle.id.
 */
function generateCircleCode() {
  return `NIA-${generateHumanCode(4)}`;
}

/**
 * 6 characters from the same restricted alphabet (31^6 ≈ 887 billion).
 * Uniqueness stays scoped per circle (@@unique([circleId, memberCode]),
 * unchanged by 10E) rather than global, so this namespace only ever needs
 * to cover one circle's membership at a time -- far more headroom than
 * that scope will ever need. Legacy 16-character hex codes issued before
 * 10E remain valid and untouched; the two shapes never collide with each
 * other (different lengths).
 */
function generateMemberCode() {
  return generateHumanCode(6);
}

function serializeDraftCircleMember(member: DraftCircleMemberRecord): DraftCircleMemberResult {
  return {
    id: member.id,
    circleId: member.circleId,
    displayName: member.displayName,
    email: member.email,
    phone: member.phone,
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
  circle: CircleActivationRecord,
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

  const freshFingerprint = computeActivationReviewFingerprint({
    circle: {
      id: circle.id,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      startDate: circle.startDate.toISOString().slice(0, 10),
      status: "DRAFT",
      originKind: circle.originKind,
      historicalCompletedRoundCount: circle.historicalCompletedRoundCount,
    },
    orderedActiveMembers,
  });
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

  try {
    const circle = await withGeneratedCodeRetry({
      maxAttempts: 5,
      generate: generateCircleCode,
      isCollision: isUniqueConstraintViolation,
      attempt: (circleCode) =>
        createDraftCircleRecord({
          ownerId: input.ownerId,
          circleCode,
          name: parsed.data.name,
          currency: parsed.data.currency,
          contributionAmount: new Prisma.Decimal(parsed.data.contributionAmount),
          frequency: parsed.data.frequency,
          startDate: toUtcDate(parsed.data.startDate),
          originKind: "NEW",
          historicalCompletedRoundCount: 0,
        }),
    });

    return {
      id: circle.id,
      circleCode: circle.circleCode,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      startDate: circle.startDate.toISOString().slice(0, 10),
      status: "DRAFT",
    };
  } catch (error) {
    if (error instanceof GeneratedCodeExhaustedError) throw new DraftCircleCodeGenerationError();
    throw error;
  }
}

export type ImportedDraftCircleResult = DraftCircleResult & {
  readonly originKind: "IMPORTED";
  readonly historicalCompletedRoundCount: number;
};

/**
 * The IMPORTED sibling of createDraftCircle (9D.1) -- same repository
 * writer (createDraftCircleRecord), same DRAFT persistence shape, only a
 * different validated input contract (createImportedDraftCircleSchema:
 * no past-date floor, requires K >= 1, requires the term-consistency
 * acknowledgement). importedAt/importedById remain null here, exactly as
 * for NEW -- freeze §4/§8: they are set once, together, only by a future
 * successful import activation (9E), never by DRAFT creation or editing.
 * This does not activate anything; activateCircle explicitly rejects an
 * IMPORTED circle until 9E exists (see IMPORTED_ACTIVATION_NOT_READY_MESSAGE).
 */
export async function createImportedDraftCircle(input: {
  ownerId: string;
  input: CreateImportedDraftCircleInput;
}): Promise<ImportedDraftCircleResult> {
  if (!input.ownerId) {
    throw new InvalidDraftCircleError("A platform User is required.");
  }

  const parsed = createImportedDraftCircleSchema.safeParse(input.input);
  if (!parsed.success) {
    throw new InvalidDraftCircleError(parsed.error.issues[0]?.message ?? "Circle details are invalid.");
  }

  try {
    const circle = await withGeneratedCodeRetry({
      maxAttempts: 5,
      generate: generateCircleCode,
      isCollision: isUniqueConstraintViolation,
      attempt: (circleCode) =>
        createDraftCircleRecord({
          ownerId: input.ownerId,
          circleCode,
          name: parsed.data.name,
          currency: parsed.data.currency,
          contributionAmount: new Prisma.Decimal(parsed.data.contributionAmount),
          frequency: parsed.data.frequency,
          startDate: toUtcDate(parsed.data.startDate),
          originKind: "IMPORTED",
          historicalCompletedRoundCount: Number(parsed.data.historicalCompletedRoundCount),
        }),
    });

    return {
      id: circle.id,
      circleCode: circle.circleCode,
      name: circle.name,
      currency: circle.currency,
      contributionAmount: circle.contributionAmount.toFixed(2),
      frequency: circle.frequency,
      startDate: circle.startDate.toISOString().slice(0, 10),
      status: "DRAFT",
      originKind: "IMPORTED",
      historicalCompletedRoundCount: circle.historicalCompletedRoundCount,
    };
  } catch (error) {
    if (error instanceof GeneratedCodeExhaustedError) throw new DraftCircleCodeGenerationError();
    throw error;
  }
}

export type DraftCircleConfigurationResult = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly contributionAmount: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly status: "DRAFT";
  readonly originKind: "NEW" | "IMPORTED";
  readonly historicalCompletedRoundCount: number;
};

// The raw (pre-validation) shape update-draft-circle-configuration.ts hands
// in: the five ordinary terms fields plus the two IMPORTED-only fields,
// all still unknown/unparsed -- the actual schema selected below (by the
// circle's own persisted, immutable originKind, never the client's say-so
// for anything but which validation branch applies) does the real parsing.
export type UpdateDraftCircleConfigurationRawInput = Record<string, unknown>;

/**
 * The one canonical owner-scoped edit operation for DRAFT terms -- extended
 * by 9D.1 to serve both NEW and IMPORTED circles through this same
 * function, repository writer, and lock (never a second, parallel import
 * editor -- docs/product/susu-existing-import-contract-freeze.md §3/§9,
 * 9D.0's own foundation). It locks the same SavingsCircle row as
 * activation; therefore either this update commits first and activation
 * re-reads its terms, or activation commits first and this operation
 * refuses the no-longer-DRAFT circle.
 *
 * `originKind` here is the CALLER's claim about which circle it is editing
 * (used only to select createDraftCircleSchema vs.
 * createImportedDraftCircleSchema-shaped validation before the row is even
 * locked) -- it is never trusted as authoritative and never written.
 * Origin is "Frozen once created" (freeze §4's own field table): once the
 * row is locked and re-read, this function requires the caller's claimed
 * originKind to equal the circle's actual persisted originKind, or refuses
 * as a conflict. This is what makes a NEW<->IMPORTED origin transition
 * structurally impossible through this path -- never a state to "normalize
 * dependent fields for," because it can never partially or fully occur.
 */
export async function updateDraftCircleConfiguration(input: {
  ownerId: string;
  circleId: string;
  originKind: (typeof CIRCLE_ORIGIN_KINDS)[number];
  input: UpdateDraftCircleConfigurationRawInput;
}): Promise<DraftCircleConfigurationResult> {
  if (!input.ownerId || !input.circleId) throw new DraftCircleConfigurationNotFoundError();

  const isImported = input.originKind === "IMPORTED";
  const schema = isImported ? updateImportedDraftCircleConfigurationSchema : updateDraftCircleConfigurationSchema;
  const parsed = schema.safeParse(input.input);
  if (!parsed.success) {
    throw new InvalidDraftCircleError(parsed.error.issues[0]?.message ?? "Circle details are invalid.");
  }
  const historicalCompletedRoundCount = isImported
    ? Number((parsed.data as UpdateImportedDraftCircleConfigurationInput).historicalCompletedRoundCount)
    : 0;

  return prisma.$transaction(async (transaction) => {
    const locked = await lockSavingsCircleForUpdate(transaction, input.circleId);
    if (!locked) throw new DraftCircleConfigurationNotFoundError();

    const circle = await findCircleForDraftConfiguration(transaction, input.circleId);
    if (!circle) throw new DraftCircleConfigurationNotFoundError();
    if (circle.ownerId !== input.ownerId) throw new DraftCircleConfigurationAuthorizationError();
    if (circle.status !== "DRAFT") throw new DraftCircleConfigurationConflictError();
    // Origin is immutable: a caller editing under the wrong assumed origin
    // (stale page, tampered hidden field, or a genuine attempted
    // NEW<->IMPORTED transition) is refused outright, never silently
    // reinterpreted under the other schema's rules.
    if (circle.originKind !== input.originKind) throw new DraftCircleConfigurationConflictError();

    const updated = await updateDraftCircleConfigurationRecord(transaction, {
      circleId: circle.id,
      name: parsed.data.name,
      currency: parsed.data.currency,
      contributionAmount: new Prisma.Decimal(parsed.data.contributionAmount),
      frequency: parsed.data.frequency,
      startDate: toUtcDate(parsed.data.startDate),
      originKind: circle.originKind,
      historicalCompletedRoundCount,
    });
    if (updated.count !== 1) throw new DraftCircleConfigurationConflictError();

    return {
      id: circle.id,
      name: parsed.data.name,
      currency: parsed.data.currency,
      contributionAmount: new Prisma.Decimal(parsed.data.contributionAmount).toFixed(2),
      frequency: parsed.data.frequency,
      startDate: parsed.data.startDate,
      status: "DRAFT",
      originKind: circle.originKind,
      historicalCompletedRoundCount,
    };
  });
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

  try {
    return await withGeneratedCodeRetry({
      maxAttempts: 5,
      generate: generateMemberCode,
      isCollision: isUniqueConstraintViolation,
      attempt: (memberCode) =>
        prisma.$transaction(async (transaction) => {
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
            phone: parsed.data.phone,
            memberCode,
            pinHash,
            addedAt: new Date(),
            addedById: input.ownerId,
          });

          return serializeDraftCircleMember(member);
        }),
    });
  } catch (error) {
    if (error instanceof GeneratedCodeExhaustedError) throw new DraftCircleMemberCodeGenerationError();
    throw error;
  }
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
    // 9D.1 guard (see IMPORTED_ACTIVATION_NOT_READY_MESSAGE): placed before
    // any status branch so it applies uniformly to a fresh DRAFT attempt
    // AND would apply to an ACTIVE-replay attempt -- though an IMPORTED
    // circle can never legitimately reach ACTIVE while this guard exists,
    // so only the DRAFT branch is reachable in practice. Removing this is
    // the entire scope of 9E; nothing else in this function may change to
    // lift it.
    if (circle.originKind === "IMPORTED") {
      throw new CircleActivationEligibilityError(IMPORTED_ACTIVATION_NOT_READY_MESSAGE);
    }

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
      assertFreshReviewMatches(input.expectedFingerprint, circle, members);
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
    assertFreshReviewMatches(input.expectedFingerprint, circle, members);
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

// ============================================================
// 9E -- Imported circle activation + historical reconstruction
// (docs/product/susu-existing-import-contract-freeze.md §5)
// ============================================================
//
// This is the canonical owner-authorized activation transaction for an
// IMPORTED DRAFT circle -- never a second, independent implementation of
// schedule generation, member ordering, or amount freezing. It reuses,
// unchanged: roundDueDate (circle-rotation-schedule.ts), the same
// payout-order-to-recipient mapping activateCircle itself uses,
// createCircleActivationRounds/createCircleActivationObligations (both
// extended additively in circle.repository.ts to accept the historical
// shape as an optional parameter -- their normal, no-argument behavior is
// byte-identical to before), assertActivationEligible,
// assertFreshReviewMatches, assertActivatedRotationIntegrity, and
// computeExpectedPayoutAmount (payout-accounting.ts, the same authority
// recordPayout/round-lifecycle already use).
//
// activateCircle itself is completely unchanged by this section (per this
// ticket's own explicit instruction) -- including its own 9D.1 guard
// rejecting IMPORTED circles, which stays exactly as it was. The action
// layer (src/actions/activate-circle.ts) now routes to whichever of the
// two functions matches the circle's own persisted origin, so that guard
// becomes a defense-in-depth backstop rather than the primary outcome an
// owner ever actually sees.

const NOT_IMPORTED_CIRCLE_MESSAGE =
  "This activation is only for a circle that is importing existing history.";

export type ImportedCircleActivationRoundResult = {
  id: string;
  roundNumber: number;
  recipientId: string;
  dueDate: string;
  status: "UPCOMING" | "CLOSED";
  closureBasis: "NIA_MANAGED" | "IMPORTED_DECLARATION";
};

export type ImportedCircleActivationResult = {
  circle: {
    id: string;
    status: "ACTIVE";
    activatedAt: string;
    importedAt: string;
    importedById: string;
  };
  memberCount: number;
  roundCount: number;
  obligationCount: number;
  historicalCompletedRoundCount: number;
  rounds: ImportedCircleActivationRoundResult[];
};

/**
 * Verifies the reconstructed historical prefix is exactly what the freeze
 * requires -- never trusted merely because it was this function's own
 * transaction that wrote it a moment ago (the ACTIVE-replay branch below
 * calls this on freshly-re-read persisted state too, exactly like
 * assertActivatedRotationIntegrity is re-run on every replay). Checked,
 * per round:
 *
 * - rounds 1..K: CLOSED + closureBasis IMPORTED_DECLARATION; every one of
 *   its obligations FULFILLED + fulfillmentBasis IMPORTED_DECLARATION with
 *   a non-null fulfilledAt; exactly one Payout, CONFIRMED + confirmationBasis
 *   IMPORTED_DECLARATION, with no member confirmer/disputer and no dispute
 *   (freeze §4's "Required interpretation of existing fields").
 * - rounds K+1..N: UPCOMING + closureBasis NIA_MANAGED; every obligation
 *   OPEN + fulfillmentBasis NIA_CONFIRMED_LEDGER with no fulfilledAt; no
 *   Payout row at all.
 *
 * This never inspects ContributionPayment (imported obligations have none
 * by construction, and this function has no query of its own into that
 * table -- it only re-verifies the rows this transaction/replay itself
 * read).
 */
/**
 * Pure K/N boundary check (freeze §2, ticket §5), extracted and exported
 * so it can be unit-tested directly without a database: K must be a
 * positive integer strictly less than N (the freshly-counted active
 * cohort). "V1 must not import an already-finished circle" (K >= N) and
 * "there is no historical lifecycle state to reconstruct" for K <= 0 are
 * both rejected here, identically -- neither is ever silently clamped or
 * coerced.
 */
export function assertImportedActivationKBounds(
  historicalCompletedRoundCount: number,
  activeMemberCount: number,
): void {
  if (!Number.isInteger(historicalCompletedRoundCount) || historicalCompletedRoundCount < 1) {
    throw new CircleActivationEligibilityError(
      "This circle's historical completed-round count must be at least 1.",
    );
  }
  if (historicalCompletedRoundCount >= activeMemberCount) {
    throw new CircleActivationEligibilityError(
      "This circle's historical completed-round count must be fewer than the final active member count.",
    );
  }
}

export function assertImportedReconstructionIntegrity(
  circle: Pick<CircleActivationRecord, "historicalCompletedRoundCount">,
  rounds: readonly CircleActivationRoundRecord[],
  obligations: readonly CircleActivationObligationRecord[],
  payouts: readonly CircleActivationPayoutRecord[],
): void {
  const K = circle.historicalCompletedRoundCount;
  const obligationsByRound = new Map<string, CircleActivationObligationRecord[]>();
  for (const obligation of obligations) {
    obligationsByRound.set(obligation.roundId, [...(obligationsByRound.get(obligation.roundId) ?? []), obligation]);
  }
  const payoutsByRound = new Map<string, CircleActivationPayoutRecord[]>();
  for (const payout of payouts) {
    payoutsByRound.set(payout.roundId, [...(payoutsByRound.get(payout.roundId) ?? []), payout]);
  }

  for (const round of rounds) {
    const roundObligations = obligationsByRound.get(round.id) ?? [];
    const roundPayouts = payoutsByRound.get(round.id) ?? [];

    if (round.roundNumber <= K) {
      if (round.status !== "CLOSED" || round.closureBasis !== "IMPORTED_DECLARATION") {
        throw new CircleActivationIntegrityError();
      }
      for (const obligation of roundObligations) {
        if (
          obligation.status !== "FULFILLED"
          || obligation.fulfillmentBasis !== "IMPORTED_DECLARATION"
          || obligation.fulfilledAt === null
        ) {
          throw new CircleActivationIntegrityError();
        }
      }
      if (roundPayouts.length !== 1) throw new CircleActivationIntegrityError();
      const payout = roundPayouts[0];
      if (
        payout.status !== "CONFIRMED"
        || payout.confirmationBasis !== "IMPORTED_DECLARATION"
        || payout.confirmedByMemberId !== null
        || payout.disputedAt !== null
        || payout.disputedByMemberId !== null
        || payout.disputeReason !== null
      ) {
        throw new CircleActivationIntegrityError();
      }
    } else {
      if (round.status !== "UPCOMING" || round.closureBasis !== "NIA_MANAGED") {
        throw new CircleActivationIntegrityError();
      }
      for (const obligation of roundObligations) {
        if (
          obligation.status !== "OPEN"
          || obligation.fulfillmentBasis !== "NIA_CONFIRMED_LEDGER"
          || obligation.fulfilledAt !== null
        ) {
          throw new CircleActivationIntegrityError();
        }
      }
      if (roundPayouts.length !== 0) throw new CircleActivationIntegrityError();
    }
  }
}

function serializeImportedActivationResult(
  circle: CircleActivationRecord,
  members: DraftCirclePayoutMemberRecord[],
  rounds: CircleActivationRoundRecord[],
  obligations: CircleActivationObligationRecord[],
): ImportedCircleActivationResult {
  if (
    circle.status !== "ACTIVE"
    || !circle.activatedAt
    || !circle.activatedById
    || !circle.importedAt
    || !circle.importedById
  ) {
    throw new CircleActivationIntegrityError();
  }

  return {
    circle: {
      id: circle.id,
      status: "ACTIVE",
      activatedAt: circle.activatedAt.toISOString(),
      importedAt: circle.importedAt.toISOString(),
      importedById: circle.importedById,
    },
    memberCount: members.length,
    roundCount: rounds.length,
    obligationCount: obligations.length,
    historicalCompletedRoundCount: circle.historicalCompletedRoundCount,
    rounds: rounds
      .sort((left, right) => left.roundNumber - right.roundNumber)
      .map((round) => ({
        id: round.id,
        roundNumber: round.roundNumber,
        recipientId: round.recipientId,
        dueDate: round.dueDate.toISOString(),
        // Structurally UPCOMING or CLOSED only -- an imported circle never
        // has an ACTIVE round immediately after this transaction (ticket
        // §14: "There must be ZERO ACTIVE rounds immediately after 9E").
        status: round.status as "UPCOMING" | "CLOSED",
        closureBasis: round.closureBasis,
      })),
  };
}

/**
 * The canonical owner-authorized activation + historical-reconstruction
 * transaction for an IMPORTED DRAFT circle (9E). Given N (the final
 * active member count, counted fresh under lock) and K (the persisted
 * historicalCompletedRoundCount, 1 <= K < N), atomically:
 *
 * 1. Generates the complete N-round / N*N-obligation structure, exactly
 *    like activateCircle -- frozen amounts/currency/due dates, the same
 *    payout-order-to-recipient mapping, same-circle integrity.
 * 2. Marks rounds 1..K CLOSED with closureBasis IMPORTED_DECLARATION,
 *    their obligations FULFILLED with fulfillmentBasis IMPORTED_DECLARATION,
 *    and inserts one CONFIRMED/IMPORTED_DECLARATION Payout each, at the
 *    frozen contributionAmount x N total -- never a fabricated
 *    ContributionPayment row, never a fabricated member payout confirmer.
 * 3. Leaves rounds K+1..N UPCOMING/NIA_MANAGED with OPEN/NIA_CONFIRMED_LEDGER
 *    obligations and no Payout row -- round K+1 is deliberately NOT
 *    activated here (a separate, later, explicit act).
 * 4. Sets importedAt/importedById (the import-declaration provenance) and
 *    activatedAt/activatedById (the normal activation provenance) --
 *    distinct fields, same authenticated owner, captured from the SAME
 *    single `now` this whole transaction commits at (see the `now`
 *    variable below for why one shared value is the honest choice here,
 *    not two independently-drifting ones).
 *
 * All authoritative inputs (K, N, terms, members, payout order, origin)
 * are re-read fresh under the SAME shared circle-row lock activateCircle
 * itself uses -- nothing here is ever trusted from client input beyond
 * ownerId/circleId/expectedFingerprint, identical in shape to activateCircle.
 * Replay of an already-ACTIVE imported circle re-verifies the exact
 * persisted shape (assertActivatedRotationIntegrity +
 * assertImportedReconstructionIntegrity) and returns it unchanged -- never
 * re-writes, never regenerates a timestamp, never reconstructs twice.
 */
export async function activateImportedCircle(input: {
  ownerId: string;
  circleId: string;
  expectedFingerprint?: string;
}): Promise<ImportedCircleActivationResult> {
  if (!input.ownerId || !input.circleId) throw new DraftCircleMemberNotFoundError();

  return prisma.$transaction(async (transaction) => {
    const lockedCircle = await lockSavingsCircleForUpdate(transaction, input.circleId);
    if (!lockedCircle) throw new DraftCircleMemberNotFoundError();

    const circle = await findCircleForActivation(transaction, input.circleId);
    if (!circle) throw new DraftCircleMemberNotFoundError();
    if (circle.ownerId !== input.ownerId) throw new DraftCircleMembershipAuthorizationError();
    // Symmetric to activateCircle's own IMPORTED guard: a NEW circle must
    // never reach imported reconstruction, no matter how this function is
    // called (the action-layer router, or any future direct caller).
    if (circle.originKind !== "IMPORTED") {
      throw new CircleActivationEligibilityError(NOT_IMPORTED_CIRCLE_MESSAGE);
    }

    const [members, rounds, obligations] = await Promise.all([
      findActiveDraftCircleMembers(transaction, circle.id),
      findCircleActivationRounds(transaction, circle.id),
      findCircleActivationObligations(transaction, circle.id),
    ]);

    if (circle.status === "ACTIVE") {
      assertActivatedRotationIntegrity(circle, members, rounds, obligations);
      const payouts = await findCircleActivationPayouts(transaction, circle.id);
      assertImportedReconstructionIntegrity(circle, rounds, obligations, payouts);
      // Same replay-idempotency guarantee as activateCircle: membership/
      // order/K/origin are frozen post-activation, so a legitimate retry's
      // fingerprint always still matches; no rounds/obligations/payouts are
      // created either way on this branch.
      assertFreshReviewMatches(input.expectedFingerprint, circle, members);
      return serializeImportedActivationResult(circle, members, rounds, obligations);
    }

    if (circle.status !== "DRAFT") {
      throw new CircleActivationEligibilityError("Only draft circles can be activated.");
    }

    // Identical structural eligibility to normal activation (>= 2 active
    // members, no pre-existing generated rotation, a complete 1..N payout
    // order) -- reused unchanged, never duplicated.
    assertActivationEligible(circle, members, rounds, obligations);

    // K/N validation (freeze §2, ticket §5): K is read from the SAME
    // fresh, lock-held circle row every other fact comes from -- never
    // from client input. N is the freshly-counted active cohort, not a
    // client-submitted number. "V1 must not import an already-finished
    // circle" (K >= N rejected) and "there is no historical lifecycle
    // state to reconstruct" for K = 0 (already unreachable here in
    // practice -- 9D.1's own DRAFT validation never persists
    // originKind=IMPORTED with K=0 -- but re-verified anyway, since this
    // function must never trust a persisted invariant it can cheaply
    // re-check).
    const K = circle.historicalCompletedRoundCount;
    const N = members.length;
    assertImportedActivationKBounds(K, N);

    // Stale-review guard (freeze §6, ticket §6): computeActivationReviewFingerprint
    // already binds originKind and historicalCompletedRoundCount alongside
    // every other mutable DRAFT fact (9D.1) -- reused completely unchanged.
    assertFreshReviewMatches(input.expectedFingerprint, circle, members);

    const membersByPayoutOrder = [...members].sort((left, right) => left.payoutOrder! - right.payoutOrder!);

    // One shared "now" for every provenance fact this transaction writes
    // (importedAt, activatedAt, each historical round's
    // activatedAt/closedAt, each historical obligation's fulfilledAt, each
    // historical payout's recordedAt/confirmedAt). This is deliberate, not
    // an oversight: unlike round-closure-vs-completion (7L section 8,
    // where two genuinely independent owner actions can happen minutes or
    // days apart and coincidentally land in the same second), every one of
    // these facts is a facet of this ONE atomic transaction -- there is no
    // real-world moment at which "NIA activated this circle" and "NIA
    // recorded the owner's import declaration" are different instants;
    // they are the same commit. Using one value is the honest
    // representation of that, not a convenience shortcut. None of these
    // timestamps is ever claimed to be when the real historical
    // event (a past contribution, a past payout) actually happened --
    // only when NIA captured the owner's declaration about it (freeze §1).
    const now = new Date();

    const generatedRounds = await createCircleActivationRounds(transaction, {
      circleId: circle.id,
      rounds: membersByPayoutOrder.map((member) => ({
        roundNumber: member.payoutOrder!,
        recipientId: member.id,
        dueDate: roundDueDate(circle, member.payoutOrder!),
        closedImport: member.payoutOrder! <= K ? { at: now, byId: input.ownerId } : undefined,
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
        fulfilledImport: round.roundNumber <= K ? { at: now } : undefined,
      }))),
    });
    if (createdObligations.count !== members.length ** 2) {
      throw new CircleActivationIntegrityError();
    }

    // The frozen expected payout total for every round (freeze §5 step 8):
    // reused, never reimplemented -- N obligations at the circle's own
    // frozen contributionAmount/currency is exactly what
    // computeExpectedPayoutAmount already authoritatively computes for any
    // round's real obligation set, so passing it N synthetic rows of the
    // same frozen amount/currency (rather than a fresh query per round for
    // an amount already known not to vary by round) reaches the identical
    // result through the same shared function, not a second formula.
    const expectedPayout = computeExpectedPayoutAmount(
      Array.from({ length: N }, () => ({ expectedAmount: circle.contributionAmount, currency: circle.currency })),
    );
    const historicalRounds = generatedRounds.filter((round) => round.roundNumber <= K);
    const createdPayouts = await createImportedRoundPayouts(transaction, {
      circleId: circle.id,
      recordedById: input.ownerId,
      importedAt: now,
      amount: expectedPayout.amount,
      currency: expectedPayout.currency,
      rounds: historicalRounds.map((round) => ({ roundId: round.id })),
    });
    if (createdPayouts.length !== K) throw new CircleActivationIntegrityError();

    const transitioned = await markCircleActive(transaction, {
      circleId: circle.id,
      activatedAt: now,
      activatedById: input.ownerId,
      importedAt: now,
      importedById: input.ownerId,
    });
    if (transitioned.count !== 1) throw new CircleActivationIntegrityError();

    const activatedCircle: CircleActivationRecord = {
      ...circle,
      status: "ACTIVE",
      activatedAt: now,
      activatedById: input.ownerId,
      importedAt: now,
      importedById: input.ownerId,
      completedAt: null,
      completedById: null,
      archivedAt: null,
      archivedById: null,
    };

    const generatedObligations = await findCircleActivationObligations(transaction, circle.id);
    const generatedPayouts = await findCircleActivationPayouts(transaction, circle.id);
    assertActivatedRotationIntegrity(activatedCircle, members, generatedRounds, generatedObligations);
    assertImportedReconstructionIntegrity(activatedCircle, generatedRounds, generatedObligations, generatedPayouts);

    return serializeImportedActivationResult(
      activatedCircle,
      members,
      generatedRounds,
      generatedObligations,
    );
  });
}
