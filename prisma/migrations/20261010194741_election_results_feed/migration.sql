-- CreateTable
CREATE TABLE "scope_result" (
    "id" SERIAL NOT NULL,
    "election_code" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "totalized_at" TIMESTAMPTZ(3),
    "disclosable" BOOLEAN NOT NULL,
    "progress" TEXT NOT NULL,
    "final" BOOLEAN NOT NULL,
    "no_winner_assigned" BOOLEAN NOT NULL,
    "sections_total" INTEGER NOT NULL,
    "sections_counted" INTEGER NOT NULL,
    "counted_sections_pct" DECIMAL(12,9) NOT NULL,
    "electorate" INTEGER NOT NULL,
    "valid_votes" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "etag" TEXT,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scope_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_result" (
    "id" SERIAL NOT NULL,
    "scope_result_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "sqcand" TEXT NOT NULL,
    "ballot_name" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "votes" INTEGER NOT NULL,
    "valid_votes_pct" DECIMAL(12,9) NOT NULL,
    "elected" BOOLEAN NOT NULL,
    "situation" TEXT,

    CONSTRAINT "candidate_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_source_state" (
    "election_code" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "last_generated_at" TIMESTAMPTZ(3),
    "last_etag" TEXT,
    "last_seen_at" TIMESTAMPTZ(3),
    "not_found_until" TIMESTAMPTZ(3),

    CONSTRAINT "scope_source_state_pkey" PRIMARY KEY ("election_code","scope")
);

-- CreateTable
CREATE TABLE "election_event" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "election_code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "text" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "election_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_status" (
    "election_code" TEXT NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "blocked_until" TIMESTAMPTZ(3),
    "feed_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "source_status_pkey" PRIMARY KEY ("election_code")
);

-- CreateIndex
CREATE INDEX "scope_result_election_code_scope_id_idx" ON "scope_result"("election_code", "scope", "id");

-- CreateIndex
CREATE UNIQUE INDEX "scope_result_election_code_scope_generation_id_key" ON "scope_result"("election_code", "scope", "generation_id");

-- CreateIndex
CREATE INDEX "candidate_result_scope_result_id_idx" ON "candidate_result"("scope_result_id");

-- CreateIndex
CREATE INDEX "election_event_election_code_occurred_at_seq_idx" ON "election_event"("election_code", "occurred_at" DESC, "seq" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "election_event_election_code_dedupe_key_key" ON "election_event"("election_code", "dedupe_key");

-- AddForeignKey
ALTER TABLE "candidate_result" ADD CONSTRAINT "candidate_result_scope_result_id_fkey" FOREIGN KEY ("scope_result_id") REFERENCES "scope_result"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
