-- Add the actor who ended a custodian assignment without altering assignment identity.
ALTER TABLE "GoalCustodian"
ADD COLUMN "endedById" TEXT;

ALTER TABLE "GoalCustodian"
ADD CONSTRAINT "GoalCustodian_endedById_fkey"
FOREIGN KEY ("endedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma does not express conditional uniqueness in @@unique.
CREATE UNIQUE INDEX "GoalCustodian_one_active_per_goal_idx"
ON "GoalCustodian" ("goalId")
WHERE "status" = 'ACTIVE'::"GoalCustodianStatus";
