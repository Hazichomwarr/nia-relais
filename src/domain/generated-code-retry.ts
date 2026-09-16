/**
 * Generic retry helper for issuing a server-generated, database-unique
 * human-facing code (10E: SavingsCircle.circleCode, CircleMember.memberCode).
 *
 * The PostgreSQL UNIQUE constraint is always the authoritative,
 * concurrency-safe guarantee -- this helper never checks a candidate for
 * availability ahead of time and assumes it is then safe to insert. It
 * always attempts the real insert first; only a genuine constraint
 * violation (as decided by the caller's own `isCollision`, e.g. a Prisma
 * P2002 error) causes a fresh candidate to be generated and retried. This
 * is what makes a candidate collision -- whether from this helper's own
 * bounded pre-check-free retry loop or from a genuinely concurrent request
 * racing to insert the same candidate -- handled identically and safely:
 * there is no separate "pre-check" code path to keep in sync with the
 * insert path.
 */

export class GeneratedCodeExhaustedError extends Error {
  constructor() {
    super("Could not generate a unique code after the maximum number of attempts.");
    this.name = "GeneratedCodeExhaustedError";
  }
}

export async function withGeneratedCodeRetry<Candidate, Result>(options: {
  readonly maxAttempts: number;
  readonly generate: () => Candidate;
  readonly attempt: (candidate: Candidate) => Promise<Result>;
  readonly isCollision: (error: unknown) => boolean;
}): Promise<Result> {
  for (let attemptNumber = 0; attemptNumber < options.maxAttempts; attemptNumber += 1) {
    const candidate = options.generate();
    try {
      return await options.attempt(candidate);
    } catch (error) {
      if (options.isCollision(error)) continue;
      throw error;
    }
  }

  throw new GeneratedCodeExhaustedError();
}
