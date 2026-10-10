-- CreateTable
CREATE TABLE "combat_event" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "election_code" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "red" TEXT NOT NULL,
    "blue" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combat_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combat_event_election_code_seq_idx" ON "combat_event"("election_code", "seq" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "combat_event_election_code_dedupe_key_key" ON "combat_event"("election_code", "dedupe_key");
