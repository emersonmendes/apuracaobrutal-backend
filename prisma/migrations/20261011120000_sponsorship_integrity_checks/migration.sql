-- Integridade do pedido no próprio banco (spec sponsorships R-3, R-4, R-5): mesmo que um bug ou
-- escrita direta tente gravar valores incoerentes, o Postgres recusa.
ALTER TABLE "sponsorship"
  ADD CONSTRAINT "sponsorship_minutes_positive" CHECK ("minutes" >= 1),
  ADD CONSTRAINT "sponsorship_unit_price_positive" CHECK ("unit_price_cents" > 0),
  ADD CONSTRAINT "sponsorship_amount_matches" CHECK ("amount_cents" = "minutes" * "unit_price_cents"),
  ADD CONSTRAINT "sponsorship_schedule_consistent" CHECK (
    ("status" = 'scheduled' AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL
       AND "ends_at" = "starts_at" + ("minutes" * interval '1 minute'))
    OR ("status" <> 'scheduled' AND "starts_at" IS NULL AND "ends_at" IS NULL)
  );
