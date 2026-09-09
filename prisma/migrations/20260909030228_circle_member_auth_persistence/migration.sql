-- AlterTable
ALTER TABLE "CircleMember" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- Prisma cannot express these security-state bounds in schema.prisma.
ALTER TABLE "CircleMember"
ADD CONSTRAINT "CircleMember_failedPinAttempts_nonnegative_check" CHECK ("failedPinAttempts" >= 0),
ADD CONSTRAINT "CircleMember_credentialVersion_positive_check" CHECK ("credentialVersion" >= 1);

-- CreateTable
CREATE TABLE "CircleMemberSession" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "CircleMemberSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CircleMemberSession"
ADD CONSTRAINT "CircleMemberSession_credentialVersion_positive_check" CHECK ("credentialVersion" >= 1);

-- CreateIndex
CREATE UNIQUE INDEX "CircleMemberSession_tokenHash_key" ON "CircleMemberSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CircleMemberSession_memberId_revokedAt_idx" ON "CircleMemberSession"("memberId", "revokedAt");

-- CreateIndex
CREATE INDEX "CircleMemberSession_expiresAt_idx" ON "CircleMemberSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "CircleMemberSession" ADD CONSTRAINT "CircleMemberSession_memberId_circleId_fkey" FOREIGN KEY ("memberId", "circleId") REFERENCES "CircleMember"("id", "circleId") ON DELETE RESTRICT ON UPDATE CASCADE;
