-- 10E: human-facing SUSU login credentials.
--
-- Adds SavingsCircle.circleCode, a short, human-facing, globally unique
-- login identifier (e.g. "NIA-7K42"), distinct from and never derived from
-- SavingsCircle.id. `id` remains the sole internal primary key / foreign-key
-- identity everywhere -- this migration does not touch any foreign key.
--
-- CircleMember.memberCode is NOT altered or backfilled by this migration:
-- existing 16-character hex codes remain exactly as issued (never
-- invalidated). Only application code (circle.service.ts) changes what it
-- generates for members added from now on -- a shorter code from the same
-- restricted alphabet as circleCode, stored in the same column. The two
-- shapes never collide (16 vs. 6 characters), so no schema change or
-- backfill is needed for CircleMember.

-- AlterTable: added nullable first so every existing row can be safely
-- backfilled one at a time below, under the same UNIQUE index that governs
-- all future inserts.
ALTER TABLE "SavingsCircle" ADD COLUMN     "circleCode" TEXT;

-- CreateIndex: created BEFORE the backfill runs, so the backfill's retry
-- logic below observes real collisions through this constraint rather than
-- an unprotected pre-check. Postgres unique indexes permit multiple NULLs,
-- so creating this before every row has a value is safe.
CREATE UNIQUE INDEX "SavingsCircle_circleCode_key" ON "SavingsCircle"("circleCode");

-- Deterministic, safe backfill (10E domain audit §16): assigns exactly one
-- unique circleCode to every pre-existing SavingsCircle row, one row at a
-- time. Never assumes a generated candidate is safe to use -- each
-- candidate is attempted via UPDATE and only accepted if the UNIQUE index
-- above actually admits it; a genuine collision (unique_violation, caught
-- via the implicit savepoint an EXCEPTION block opens) is retried with a
-- fresh candidate, up to a small bounded count per row. Exhausting that
-- bound aborts the entire migration (no row is ever left without a code,
-- and no possible duplicate is ever committed) rather than failing softly.
-- No financial/lifecycle/provenance column is read or written by this
-- block.
DO $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  target_row RECORD;
  candidate TEXT;
  attempt INT;
  max_attempts CONSTANT INT := 50;
BEGIN
  FOR target_row IN
    SELECT "id" FROM "SavingsCircle" WHERE "circleCode" IS NULL ORDER BY "createdAt" ASC, "id" ASC
  LOOP
    attempt := 0;
    LOOP
      attempt := attempt + 1;
      candidate := 'NIA-' || (
        SELECT string_agg(substr(alphabet, (floor(random() * length(alphabet)) + 1)::int, 1), '')
        FROM generate_series(1, 4)
      );

      BEGIN
        UPDATE "SavingsCircle" SET "circleCode" = candidate WHERE "id" = target_row."id";
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempt >= max_attempts THEN
          RAISE EXCEPTION 'Could not generate a unique circleCode for SavingsCircle % after % attempts', target_row."id", max_attempts;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- AlterTable: every row now has a value (backfilled above, and every new
-- insert already required to supply one) -- the column can become
-- mandatory.
ALTER TABLE "SavingsCircle" ALTER COLUMN "circleCode" SET NOT NULL;

-- Canonical shape enforced at the database boundary too, not only in
-- application code (same precedent as CircleMember's existing
-- failedPinAttempts/credentialVersion CHECK constraints).
ALTER TABLE "SavingsCircle"
ADD CONSTRAINT "SavingsCircle_circleCode_format_check" CHECK ("circleCode" ~ '^NIA-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$');
