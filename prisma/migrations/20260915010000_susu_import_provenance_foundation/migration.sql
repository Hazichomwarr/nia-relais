-- CreateEnum
CREATE TYPE "CircleOriginKind" AS ENUM ('NEW', 'IMPORTED');

-- CreateEnum
CREATE TYPE "RoundClosureBasis" AS ENUM ('NIA_MANAGED', 'IMPORTED_DECLARATION');

-- CreateEnum
CREATE TYPE "ContributionFulfillmentBasis" AS ENUM ('NIA_CONFIRMED_LEDGER', 'IMPORTED_DECLARATION');

-- CreateEnum
CREATE TYPE "PayoutConfirmationBasis" AS ENUM ('MEMBER_CONFIRMED', 'IMPORTED_DECLARATION');

-- AlterTable
ALTER TABLE "SavingsCircle"
  ADD COLUMN "originKind" "CircleOriginKind" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "historicalCompletedRoundCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "importedAt" TIMESTAMP(3),
  ADD COLUMN "importedById" TEXT;

-- AlterTable
ALTER TABLE "PayoutRound"
  ADD COLUMN "closureBasis" "RoundClosureBasis" NOT NULL DEFAULT 'NIA_MANAGED';

-- AlterTable
ALTER TABLE "ContributionObligation"
  ADD COLUMN "fulfillmentBasis" "ContributionFulfillmentBasis" NOT NULL DEFAULT 'NIA_CONFIRMED_LEDGER';

-- AlterTable
ALTER TABLE "Payout"
  ADD COLUMN "confirmationBasis" "PayoutConfirmationBasis" NOT NULL DEFAULT 'MEMBER_CONFIRMED';

-- AddConstraint
ALTER TABLE "SavingsCircle"
  ADD CONSTRAINT "SavingsCircle_historicalCompletedRoundCount_nonnegative_check"
  CHECK ("historicalCompletedRoundCount" >= 0);

-- AddForeignKey
ALTER TABLE "SavingsCircle"
  ADD CONSTRAINT "SavingsCircle_importedById_fkey"
  FOREIGN KEY ("importedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
