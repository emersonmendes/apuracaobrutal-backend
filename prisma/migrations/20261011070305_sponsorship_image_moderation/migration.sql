-- CreateEnum
CREATE TYPE "sponsorship_moderation" AS ENUM ('pending', 'approved', 'rejected', 'error');

-- CreateEnum
CREATE TYPE "moderation_outcome" AS ENUM ('approved', 'rejected', 'error');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "sponsorship_expiry_reason" ADD VALUE 'moderation_rejected';
ALTER TYPE "sponsorship_expiry_reason" ADD VALUE 'moderation_error';
ALTER TYPE "sponsorship_expiry_reason" ADD VALUE 'moderation_pending';

-- AlterTable
ALTER TABLE "sponsorship" ADD COLUMN     "image_sha256" TEXT,
ADD COLUMN     "moderated_at" TIMESTAMPTZ(3),
ADD COLUMN     "moderation" "sponsorship_moderation" NOT NULL DEFAULT 'pending',
ADD COLUMN     "moderation_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "moderation_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "moderation_claimed_until" TIMESTAMPTZ(3),
ADD COLUMN     "moderation_next_attempt_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "sponsorship_moderation_record" (
    "id" UUID NOT NULL,
    "sponsorship_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "policy_version" TEXT NOT NULL,
    "outcome" "moderation_outcome" NOT NULL,
    "model_decision" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detected_text" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "rejection_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error_code" TEXT,
    "request_id" TEXT,
    "image_sha256" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sponsorship_moderation_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsorship_moderation_record_sponsorship_id_idx" ON "sponsorship_moderation_record"("sponsorship_id");

-- CreateIndex
CREATE INDEX "sponsorship_moderation_record_provider_created_at_idx" ON "sponsorship_moderation_record"("provider", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_moderation_record_sponsorship_id_attempt_key" ON "sponsorship_moderation_record"("sponsorship_id", "attempt");

-- CreateIndex
CREATE INDEX "sponsorship_moderation_moderation_next_attempt_at_idx" ON "sponsorship"("moderation", "moderation_next_attempt_at");
