-- AlterEnum
ALTER TYPE "GoalCustodianStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "GoalCustodian" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AddForeignKey
ALTER TABLE "GoalCustodian" ADD CONSTRAINT "GoalCustodian_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
