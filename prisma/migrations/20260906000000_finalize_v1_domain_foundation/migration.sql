-- CreateEnum
CREATE TYPE "GoalCustodianStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'ENDED');

-- DropForeignKey
ALTER TABLE "CircleMember" DROP CONSTRAINT "CircleMember_groupMemberId_fkey";

-- DropForeignKey
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_memberId_fkey";

-- DropForeignKey
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_roundId_fkey";

-- DropForeignKey
ALTER TABLE "GroupMember" DROP CONSTRAINT "GroupMember_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupMember" DROP CONSTRAINT "GroupMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "PayoutRound" DROP CONSTRAINT "PayoutRound_receiverId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalGoal" DROP CONSTRAINT "PersonalGoal_groupId_fkey";

-- DropForeignKey
ALTER TABLE "RelaisGroup" DROP CONSTRAINT "RelaisGroup_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SavingsCircle" DROP CONSTRAINT "SavingsCircle_groupId_fkey";

-- DropIndex
DROP INDEX "CircleMember_circleId_groupMemberId_key";

-- AlterTable
ALTER TABLE "CircleMember" DROP COLUMN "groupMemberId",
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "memberCode" TEXT,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "missedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "PayoutRound" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "PersonalGoal" DROP COLUMN "groupId",
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "currency" CHAR(3) NOT NULL,
ALTER COLUMN "targetAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "weeklyAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "SavingsCircle" DROP COLUMN "groupId",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "currency" CHAR(3) NOT NULL,
ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ALTER COLUMN "contributionAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "loginType";

-- DropTable
DROP TABLE "GroupMember";

-- DropTable
DROP TABLE "RelaisGroup";

-- DropEnum
DROP TYPE "GroupRole";

-- DropEnum
DROP TYPE "GroupType";

-- DropEnum
DROP TYPE "LoginType";

-- DropEnum
DROP TYPE "MemberStatus";

-- CreateTable
CREATE TABLE "GoalCustodian" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "status" "GoalCustodianStatus" NOT NULL DEFAULT 'PENDING',
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalCustodian_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalCustodian_goalId_status_idx" ON "GoalCustodian"("goalId", "status");

-- CreateIndex
CREATE INDEX "GoalCustodian_userId_status_idx" ON "GoalCustodian"("userId", "status");

-- CreateIndex
CREATE INDEX "CircleMember_circleId_status_idx" ON "CircleMember"("circleId", "status");

-- CreateIndex
CREATE INDEX "CircleMember_userId_idx" ON "CircleMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CircleMember_circleId_payoutOrder_key" ON "CircleMember"("circleId", "payoutOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CircleMember_circleId_memberCode_key" ON "CircleMember"("circleId", "memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "CircleMember_circleId_userId_key" ON "CircleMember"("circleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CircleMember_id_circleId_key" ON "CircleMember"("id", "circleId");

-- CreateIndex
CREATE INDEX "Contribution_circleId_memberId_status_idx" ON "Contribution"("circleId", "memberId", "status");

-- CreateIndex
CREATE INDEX "Contribution_circleId_roundId_status_idx" ON "Contribution"("circleId", "roundId", "status");

-- CreateIndex
CREATE INDEX "Deposit_goalId_status_idx" ON "Deposit"("goalId", "status");

-- CreateIndex
CREATE INDEX "PayoutRound_circleId_status_idx" ON "PayoutRound"("circleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRound_circleId_receiverId_key" ON "PayoutRound"("circleId", "receiverId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRound_id_circleId_key" ON "PayoutRound"("id", "circleId");

-- CreateIndex
CREATE INDEX "PersonalGoal_ownerId_status_idx" ON "PersonalGoal"("ownerId", "status");

-- CreateIndex
CREATE INDEX "SavingsCircle_ownerId_status_idx" ON "SavingsCircle"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "GoalCustodian" ADD CONSTRAINT "GoalCustodian_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "PersonalGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalCustodian" ADD CONSTRAINT "GoalCustodian_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalCustodian" ADD CONSTRAINT "GoalCustodian_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsCircle" ADD CONSTRAINT "SavingsCircle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRound" ADD CONSTRAINT "PayoutRound_receiverId_circleId_fkey" FOREIGN KEY ("receiverId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_roundId_circleId_fkey" FOREIGN KEY ("roundId", "circleId") REFERENCES "PayoutRound"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_memberId_circleId_fkey" FOREIGN KEY ("memberId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;
