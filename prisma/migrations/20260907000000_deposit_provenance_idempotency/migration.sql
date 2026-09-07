-- CreateEnum
CREATE TYPE "DepositVerificationMode" AS ENUM ('OWNER', 'CUSTODIAN');

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "clientOperationId" TEXT NOT NULL,
ADD COLUMN     "recordedById" TEXT NOT NULL,
ADD COLUMN     "rejectionReason" VARCHAR(500),
ADD COLUMN     "responsibleCustodianId" TEXT,
ADD COLUMN     "verificationMode" "DepositVerificationMode" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_goalId_clientOperationId_key" ON "Deposit"("goalId", "clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalCustodian_id_goalId_key" ON "GoalCustodian"("id", "goalId");

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_responsibleCustodianId_goalId_fkey" FOREIGN KEY ("responsibleCustodianId", "goalId") REFERENCES "GoalCustodian"("id", "goalId") ON DELETE RESTRICT ON UPDATE CASCADE;
