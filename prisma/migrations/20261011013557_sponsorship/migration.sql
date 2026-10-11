-- CreateEnum
CREATE TYPE "sponsorship_slot" AS ENUM ('side_left', 'side_right', 'center', 'floor', 'glove_red', 'glove_blue');

-- CreateEnum
CREATE TYPE "sponsorship_status" AS ENUM ('pending_payment', 'scheduled', 'expired');

-- CreateTable
CREATE TABLE "sponsorship" (
    "id" UUID NOT NULL,
    "slot" "sponsorship_slot" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "advertiser_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "image_key" TEXT,
    "status" "sponsorship_status" NOT NULL,
    "payment_gateway" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),

    CONSTRAINT "sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsorship_slot_status_ends_at_idx" ON "sponsorship"("slot", "status", "ends_at");
