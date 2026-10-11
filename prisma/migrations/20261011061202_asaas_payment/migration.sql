-- CreateEnum
CREATE TYPE "sponsorship_payment_method" AS ENUM ('pix', 'credit_card', 'other');

-- CreateEnum
CREATE TYPE "sponsorship_refund" AS ENUM ('none', 'requested', 'done', 'failed');

-- CreateEnum
CREATE TYPE "sponsorship_expiry_reason" AS ENUM ('payment_timeout', 'price_changed');

-- CreateEnum
CREATE TYPE "payment_webhook_outcome" AS ENUM ('scheduled', 'refund_requested', 'refund_done', 'ignored', 'rejected');

-- AlterTable
ALTER TABLE "sponsorship" ADD COLUMN     "cpf_cnpj" TEXT,
ADD COLUMN     "expiry_reason" "sponsorship_expiry_reason",
ADD COLUMN     "gateway_customer_id" TEXT,
ADD COLUMN     "invoice_url" TEXT,
ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_method" "sponsorship_payment_method",
ADD COLUMN     "refund" "sponsorship_refund" NOT NULL DEFAULT 'none',
ADD COLUMN     "refund_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "payment_webhook_event" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "charge_id" TEXT,
    "sponsorship_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "payment_webhook_outcome" NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "payment_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_webhook_event_sponsorship_id_idx" ON "payment_webhook_event"("sponsorship_id");

-- CreateIndex
CREATE INDEX "sponsorship_refund_idx" ON "sponsorship"("refund");

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_payment_gateway_charge_id_key" ON "sponsorship"("payment_gateway", "charge_id");

