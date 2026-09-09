/*
  Warnings:

  - The values [PAID] on the enum `PayoutRoundStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `paidAt` on the `PayoutRound` table. All the data in the column will be lost.
  - You are about to drop the column `receiverId` on the `PayoutRound` table. All the data in the column will be lost.
  - You are about to drop the column `cancelledAt` on the `SavingsCircle` table. All the data in the column will be lost.
  - You are about to drop the column `startedAt` on the `SavingsCircle` table. All the data in the column will be lost.
  - You are about to drop the `Contribution` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[circleId,recipientId]` on the table `PayoutRound` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `addedById` to the `CircleMember` table without a default value. This is not possible if the table is not empty.
  - Made the column `memberCode` on table `CircleMember` required. This step will fail if there are existing NULL values in that column.
  - Made the column `pinHash` on table `CircleMember` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `recipientId` to the `PayoutRound` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `SavingsCircle` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ContributionObligationStatus" AS ENUM ('OPEN', 'FULFILLED');

-- CreateEnum
CREATE TYPE "ContributionPaymentStatus" AS ENUM ('RECORDED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('RECORDED', 'CONFIRMED', 'DISPUTED');

-- AlterEnum
ALTER TYPE "CircleStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
BEGIN;
CREATE TYPE "PayoutRoundStatus_new" AS ENUM ('UPCOMING', 'ACTIVE', 'CLOSED');
ALTER TABLE "public"."PayoutRound" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PayoutRound" ALTER COLUMN "status" TYPE "PayoutRoundStatus_new" USING ("status"::text::"PayoutRoundStatus_new");
ALTER TYPE "PayoutRoundStatus" RENAME TO "PayoutRoundStatus_old";
ALTER TYPE "PayoutRoundStatus_new" RENAME TO "PayoutRoundStatus";
DROP TYPE "public"."PayoutRoundStatus_old";
ALTER TABLE "PayoutRound" ALTER COLUMN "status" SET DEFAULT 'UPCOMING';
COMMIT;

-- DropForeignKey
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_circleId_fkey";

-- DropForeignKey
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_memberId_circleId_fkey";

-- DropForeignKey
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_roundId_circleId_fkey";

-- DropForeignKey
ALTER TABLE "PayoutRound" DROP CONSTRAINT "PayoutRound_receiverId_circleId_fkey";

-- DropIndex
DROP INDEX "CircleMember_circleId_payoutOrder_key";

-- DropIndex
DROP INDEX "PayoutRound_circleId_receiverId_key";

-- DropIndex
DROP INDEX "PayoutRound_circleId_status_idx";

-- AlterTable
ALTER TABLE "CircleMember" ADD COLUMN     "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "addedById" TEXT NOT NULL,
ADD COLUMN     "removedById" TEXT,
ALTER COLUMN "memberCode" SET NOT NULL,
ALTER COLUMN "pinHash" SET NOT NULL;

-- AlterTable
ALTER TABLE "PayoutRound" DROP COLUMN "paidAt",
DROP COLUMN "receiverId",
ADD COLUMN     "activatedById" TEXT,
ADD COLUMN     "recipientId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SavingsCircle" DROP COLUMN "cancelledAt",
DROP COLUMN "startedAt",
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activatedById" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "Contribution";

-- DropEnum
DROP TYPE "ContributionStatus";

-- CreateTable
CREATE TABLE "ContributionObligation" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "expectedAmount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ContributionObligationStatus" NOT NULL DEFAULT 'OPEN',
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionPayment" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ContributionPaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "clientOperationId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'RECORDED',
    "clientOperationId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByMemberId" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputedByMemberId" TEXT,
    "disputeReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributionObligation_circleId_roundId_status_idx" ON "ContributionObligation"("circleId", "roundId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionObligation_roundId_memberId_key" ON "ContributionObligation"("roundId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionObligation_id_circleId_key" ON "ContributionObligation"("id", "circleId");

-- CreateIndex
CREATE INDEX "ContributionPayment_circleId_obligationId_status_idx" ON "ContributionPayment"("circleId", "obligationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionPayment_circleId_clientOperationId_key" ON "ContributionPayment"("circleId", "clientOperationId");

-- CreateIndex
CREATE INDEX "Payout_circleId_status_idx" ON "Payout"("circleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_roundId_key" ON "Payout"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_circleId_clientOperationId_key" ON "Payout"("circleId", "clientOperationId");

-- Partial unique indexes cannot be represented by Prisma schema attributes.
-- Active draft participants retain their payout order; removed draft members do not block reuse.
CREATE UNIQUE INDEX "CircleMember_active_payout_order_key" ON "CircleMember"("circleId", "payoutOrder")
WHERE "status" = 'ACTIVE'::"CircleMemberStatus" AND "payoutOrder" IS NOT NULL;

-- A rejected payment remains historical, while each obligation has at most one pending or confirmed payment.
CREATE UNIQUE INDEX "ContributionPayment_one_unresolved_or_confirmed_per_obligation_idx" ON "ContributionPayment"("obligationId")
WHERE "status" IN ('RECORDED'::"ContributionPaymentStatus", 'CONFIRMED'::"ContributionPaymentStatus");

-- CreateIndex
CREATE INDEX "PayoutRound_circleId_status_roundNumber_idx" ON "PayoutRound"("circleId", "status", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRound_circleId_recipientId_key" ON "PayoutRound"("circleId", "recipientId");

-- AddForeignKey
ALTER TABLE "SavingsCircle" ADD CONSTRAINT "SavingsCircle_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsCircle" ADD CONSTRAINT "SavingsCircle_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsCircle" ADD CONSTRAINT "SavingsCircle_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRound" ADD CONSTRAINT "PayoutRound_recipientId_circleId_fkey" FOREIGN KEY ("recipientId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRound" ADD CONSTRAINT "PayoutRound_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionObligation" ADD CONSTRAINT "ContributionObligation_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "SavingsCircle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionObligation" ADD CONSTRAINT "ContributionObligation_roundId_circleId_fkey" FOREIGN KEY ("roundId", "circleId") REFERENCES "PayoutRound"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionObligation" ADD CONSTRAINT "ContributionObligation_memberId_circleId_fkey" FOREIGN KEY ("memberId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "SavingsCircle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_obligationId_circleId_fkey" FOREIGN KEY ("obligationId", "circleId") REFERENCES "ContributionObligation"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "SavingsCircle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_roundId_circleId_fkey" FOREIGN KEY ("roundId", "circleId") REFERENCES "PayoutRound"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_confirmedByMemberId_circleId_fkey" FOREIGN KEY ("confirmedByMemberId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_disputedByMemberId_circleId_fkey" FOREIGN KEY ("disputedByMemberId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;
