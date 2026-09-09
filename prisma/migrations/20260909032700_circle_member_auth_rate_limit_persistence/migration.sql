-- CreateEnum
CREATE TYPE "CircleMemberAuthRateLimitScope" AS ENUM ('SOURCE', 'TARGET', 'GLOBAL');

-- CreateTable
CREATE TABLE "CircleMemberAuthRateLimitBucket" (
    "id" TEXT NOT NULL,
    "scope" "CircleMemberAuthRateLimitScope" NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CircleMemberAuthRateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- Prisma cannot express these bounded security-counter and HMAC representation checks.
ALTER TABLE "CircleMemberAuthRateLimitBucket"
ADD CONSTRAINT "CircleMemberAuthRateLimitBucket_attemptCount_nonnegative_check" CHECK ("attemptCount" >= 0),
ADD CONSTRAINT "CircleMemberAuthRateLimitBucket_keyHash_lowercase_hex_check" CHECK ("keyHash" ~ '^[0-9a-f]{64}$');

-- CreateIndex
CREATE INDEX "CircleMemberAuthRateLimitBucket_expiresAt_idx" ON "CircleMemberAuthRateLimitBucket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CircleMemberAuthRateLimitBucket_scope_keyHash_windowStart_key" ON "CircleMemberAuthRateLimitBucket"("scope", "keyHash", "windowStart");
